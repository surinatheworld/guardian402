// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockTarget} from "../mocks/MockTarget.sol";

/// Shared fixture: a vault seeded like SPEC §4.8 (USDC cap 20 / maxApproval 10 / threshold 1; native cap
/// 0.1 AVAX / threshold 0.01 AVAX), one allowed target (also an allowed recipient so it can be approved) and a
/// treasury recipient. Verdicts are signed with a fixed guardian key over an independently computed digest.
abstract contract AgentVaultBase is Test {
    uint256 internal constant GUARDIAN_PK = 0x6A12D1A4;
    uint256 internal constant USDC_CAP = 20e6;
    uint256 internal constant USDC_MAX_APPROVAL = 10e6;
    uint256 internal constant USDC_THRESHOLD = 1e6;
    uint256 internal constant NATIVE_CAP = 0.1 ether;
    uint256 internal constant NATIVE_THRESHOLD = 0.01 ether;
    uint256 internal constant VAULT_USDC = 50e6;
    uint256 internal constant VAULT_NATIVE = 1 ether;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant VERDICT_TYPEHASH =
        keccak256("Verdict(bytes32 callsHash,uint256 nonce,uint64 deadline,uint8 risk,bytes32 checkId)");
    bytes32 internal constant CHECK_ID = keccak256("check-1");

    AgentVault internal vault;
    MockUSDC internal usdc;
    MockTarget internal target;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal guardian;
    address internal treasury = makeAddr("treasury");
    address internal attacker = makeAddr("attacker");

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        guardian = vm.addr(GUARDIAN_PK);
        usdc = new MockUSDC();
        target = new MockTarget();
        vault = new AgentVault(owner, agent, guardian);

        vm.startPrank(owner);
        vault.setTokenPolicy(address(usdc), true, USDC_CAP, USDC_MAX_APPROVAL, USDC_THRESHOLD);
        vault.setNativePolicy(NATIVE_CAP, NATIVE_THRESHOLD);
        vault.setAllowedTarget(address(target), true);
        vault.setAllowedSelector(address(target), MockTarget.ping.selector, true);
        vault.setAllowedSelector(address(target), MockTarget.pull.selector, true);
        vault.setAllowedSelector(address(target), MockTarget.refund.selector, true);
        vault.setAllowedSelector(address(target), MockTarget.fail.selector, true);
        vault.setAllowedRecipient(address(target), true);
        vault.setAllowedRecipient(treasury, true);
        vm.stopPrank();

        usdc.mint(address(vault), VAULT_USDC);
        vm.deal(address(vault), VAULT_NATIVE);
    }

    // ------------------------------------------------------------ call builders

    function _transfer(address to, uint256 amount) internal view returns (AgentVault.Call memory) {
        return AgentVault.Call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _approve(address spender, uint256 amount) internal view returns (AgentVault.Call memory) {
        return AgentVault.Call(address(usdc), 0, abi.encodeCall(IERC20.approve, (spender, amount)));
    }

    function _pull(uint256 amount) internal view returns (AgentVault.Call memory) {
        return AgentVault.Call(address(target), 0, abi.encodeCall(MockTarget.pull, (IERC20(address(usdc)), amount)));
    }

    function _refund(uint256 amount) internal view returns (AgentVault.Call memory) {
        return AgentVault.Call(address(target), 0, abi.encodeCall(MockTarget.refund, (IERC20(address(usdc)), amount)));
    }

    function _ping(uint256 value) internal view returns (AgentVault.Call memory) {
        return AgentVault.Call(address(target), value, abi.encodeCall(MockTarget.ping, (1)));
    }

    function _native(address to, uint256 value) internal pure returns (AgentVault.Call memory) {
        return AgentVault.Call(to, value, "");
    }

    function _one(AgentVault.Call memory a) internal pure returns (AgentVault.Call[] memory calls) {
        calls = new AgentVault.Call[](1);
        calls[0] = a;
    }

    function _two(AgentVault.Call memory a, AgentVault.Call memory b)
        internal
        pure
        returns (AgentVault.Call[] memory calls)
    {
        calls = new AgentVault.Call[](2);
        calls[0] = a;
        calls[1] = b;
    }

    // ---------------------------------------------------------------- verdicts

    function _hash(AgentVault.Call[] memory calls) internal pure returns (bytes32) {
        return keccak256(abi.encode(calls));
    }

    /// @dev EIP-712 digest computed without the vault, to cross-check verdictDigest().
    function _digest(AgentVault.Verdict memory v) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("Guardian402 AgentVault"), keccak256("1"), block.chainid, address(vault)
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(VERDICT_TYPEHASH, v.callsHash, v.nonce, v.deadline, v.risk, v.checkId));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _signWith(uint256 pk, AgentVault.Verdict memory v) internal view returns (bytes memory) {
        (uint8 r8, bytes32 r, bytes32 s) = vm.sign(pk, _digest(v));
        return abi.encodePacked(r, s, r8);
    }

    function _verdictFor(AgentVault.Call[] memory calls, uint8 risk) internal view returns (AgentVault.Verdict memory) {
        return AgentVault.Verdict({
            callsHash: _hash(calls),
            nonce: vault.verdictNonce(),
            deadline: uint64(vm.getBlockTimestamp() + 60),
            risk: risk,
            checkId: CHECK_ID
        });
    }

    function _noVerdict() internal pure returns (AgentVault.Verdict memory v) {}

    // --------------------------------------------------------------- executors

    function _exec(AgentVault.Call[] memory calls) internal {
        vm.prank(agent);
        vault.executeBatch(calls, _noVerdict(), "");
    }

    function _execWithVerdict(AgentVault.Call[] memory calls, uint8 risk) internal {
        AgentVault.Verdict memory v = _verdictFor(calls, risk);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.prank(agent);
        vault.executeBatch(calls, v, sig);
    }

    /// @dev Signs first, so vm.expectRevert applies to executeBatch and not to the verdictNonce() read.
    function _execWithVerdictExpectRevert(AgentVault.Call[] memory calls, uint8 risk, bytes memory revertData)
        internal
    {
        AgentVault.Verdict memory v = _verdictFor(calls, risk);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectRevert(revertData);
        _execSigned(calls, v, sig);
    }

    function _execSigned(AgentVault.Call[] memory calls, AgentVault.Verdict memory v, bytes memory sig) internal {
        vm.prank(agent);
        vault.executeBatch(calls, v, sig);
    }

    function _today() internal view returns (uint256) {
        return vm.getBlockTimestamp() / 1 days;
    }
}
