// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockTarget} from "./mocks/MockTarget.sol";
import {AgentVaultBase} from "./utils/AgentVaultBase.sol";

/// Drives the vault with random agent batches (with and without verdicts, honest and malicious), owner
/// overrides, pause/unpause and time warps, and records ghost state for the invariants of SPEC §4.5.
contract VaultHandler is Test {
    uint256 internal constant GUARDIAN_PK = 0x6A12D1A4;
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant VERDICT_TYPEHASH =
        keccak256("Verdict(bytes32 callsHash,uint256 nonce,uint64 deadline,uint8 risk,bytes32 checkId)");

    AgentVault public immutable vault;
    MockUSDC public immutable usdc;
    MockTarget public immutable target;
    address public immutable owner;
    address public immutable agent;
    address public immutable treasury;
    address public immutable attacker;

    // ghost state
    mapping(address token => mapping(uint256 day => uint256 amount)) public agentOutflow;
    uint256[] public touchedDays;
    mapping(uint256 day => bool) internal _dayTouched;
    bool public ghostPaused;
    uint256 public verdictsConsumed;
    uint256 public maxNonceSeen;
    bool public movedWhilePaused;
    bool public attackerPaid;
    bool public replayAccepted;
    bool public foreignVerdictAccepted;
    bool public agentChangedAdmin;
    bool public nonceDecreased;
    uint256 public agentSucceeded;
    uint256 public agentBlocked;

    AgentVault.Call[] internal _lastCalls;
    AgentVault.Verdict internal _lastVerdict;
    bytes internal _lastSig;
    bool internal _hasLast;

    constructor(
        AgentVault vault_,
        MockUSDC usdc_,
        MockTarget target_,
        address owner_,
        address agent_,
        address treasury_,
        address attacker_
    ) {
        vault = vault_;
        usdc = usdc_;
        target = target_;
        owner = owner_;
        agent = agent_;
        treasury = treasury_;
        attacker = attacker_;
    }

    // ----------------------------------------------------------- agent path

    function agentTransfer(uint256 amount, bool withVerdict) external {
        amount = bound(amount, 1, 8e6); // a few batches reach the 20 USDC cap
        _agent(_single(_transferCall(treasury, amount)), withVerdict);
    }

    function agentNative(uint256 value, bool withVerdict) external {
        value = bound(value, 1, 0.04 ether); // a few batches reach the 0.1 AVAX cap
        _agent(_single(AgentVault.Call(treasury, value, "")), withVerdict);
    }

    function agentSwapLike(uint256 amount, bool withVerdict) external {
        amount = bound(amount, 1, 6e6); // above 10 USDC maxApproval is covered by unit tests
        AgentVault.Call[] memory calls = new AgentVault.Call[](2);
        calls[0] = AgentVault.Call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(target), amount)));
        calls[1] = AgentVault.Call(address(target), 0, abi.encodeCall(MockTarget.pull, (IERC20(address(usdc)), amount)));
        _agent(calls, withVerdict);
    }

    /// @dev Malicious: pays the attacker. Must never succeed.
    function agentDrainToAttacker(uint256 amount, bool native) external {
        amount = bound(amount, 1, 1e6);
        AgentVault.Call[] memory calls =
            _single(native ? AgentVault.Call(attacker, amount, "") : _transferCall(attacker, amount));
        uint256 beforeUsdc = usdc.balanceOf(attacker);
        uint256 beforeNative = attacker.balance;
        _agent(calls, true);
        if (usdc.balanceOf(attacker) != beforeUsdc || attacker.balance != beforeNative) attackerPaid = true;
    }

    /// @dev Malicious: replays the last verdict that was accepted. Must never succeed.
    function agentReplay() external {
        if (!_hasLast) return;
        AgentVault.Call[] memory calls = _lastCalls;
        vm.prank(agent);
        try vault.executeBatch(calls, _lastVerdict, _lastSig) {
            replayAccepted = true;
        } catch {}
    }

    /// @dev Malicious: a valid verdict for calls A sent with calls B. Must never succeed.
    function agentForeignVerdict(uint256 signedAmount, uint256 sentAmount) external {
        signedAmount = bound(signedAmount, 1, 5e6);
        sentAmount = bound(sentAmount, 1, 5e6);
        if (signedAmount == sentAmount) return;
        (AgentVault.Verdict memory v, bytes memory sig) = _sign(_single(_transferCall(treasury, signedAmount)));
        vm.prank(agent);
        try vault.executeBatch(_single(_transferCall(treasury, sentAmount)), v, sig) {
            foreignVerdictAccepted = true;
        } catch {}
    }

    /// @dev Malicious: the agent calls owner-only functions. Every call must revert.
    function agentTriesAdmin(uint256 which) external {
        bytes[8] memory payloads = [
            abi.encodeCall(AgentVault.setAgent, (attacker)),
            abi.encodeCall(AgentVault.setGuardian, (attacker)),
            abi.encodeCall(AgentVault.pause, ()),
            abi.encodeCall(AgentVault.unpause, ()),
            abi.encodeCall(AgentVault.setTokenPolicy, (address(usdc), true, type(uint256).max, type(uint256).max, 0)),
            abi.encodeCall(AgentVault.setNativePolicy, (type(uint256).max, type(uint256).max)),
            abi.encodeCall(AgentVault.setAllowedRecipient, (attacker, true)),
            abi.encodeCall(AgentVault.setMaxAgentRisk, (2))
        ];
        vm.prank(agent);
        (bool ok,) = address(vault).call(payloads[bound(which, 0, 7)]);
        if (ok) agentChangedAdmin = true;
        vm.prank(agent);
        (ok,) = address(vault).call(abi.encodeCall(vault.transferOwnership, (agent)));
        if (ok) agentChangedAdmin = true;
    }

    // ----------------------------------------------------------- owner path

    function ownerExecute(uint256 amount) external {
        amount = bound(amount, 0, usdc.balanceOf(address(vault)));
        vm.prank(owner);
        vault.ownerExecute(_single(_transferCall(owner, amount)));
    }

    function ownerTopUp(uint256 amount, uint256 value) external {
        usdc.mint(address(vault), bound(amount, 0, 30e6));
        vm.deal(address(vault), address(vault).balance + bound(value, 0, 0.2 ether));
    }

    function pause() external {
        vm.prank(owner);
        vault.pause();
        ghostPaused = true;
    }

    function unpause() external {
        vm.prank(owner);
        vault.unpause();
        ghostPaused = false;
    }

    function warp(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 0, 2 days));
    }

    // -------------------------------------------------------------- helpers

    function touchedDayCount() external view returns (uint256) {
        return touchedDays.length;
    }

    function _agent(AgentVault.Call[] memory calls, bool withVerdict) internal {
        AgentVault.Verdict memory v;
        bytes memory sig;
        if (withVerdict) (v, sig) = _sign(calls);
        bool wasPaused = vault.paused();
        uint256 usdcBefore = usdc.balanceOf(address(vault));
        uint256 nativeBefore = address(vault).balance;
        uint256 nonceBefore = vault.verdictNonce();

        vm.prank(agent);
        try vault.executeBatch(calls, v, sig) {
            ++agentSucceeded;
            if (wasPaused) movedWhilePaused = true;
            uint256 day = block.timestamp / 1 days;
            if (!_dayTouched[day]) {
                _dayTouched[day] = true;
                touchedDays.push(day);
            }
            uint256 usdcAfter = usdc.balanceOf(address(vault));
            uint256 nativeAfter = address(vault).balance;
            if (usdcAfter < usdcBefore) agentOutflow[address(usdc)][day] += usdcBefore - usdcAfter;
            if (nativeAfter < nativeBefore) agentOutflow[address(0)][day] += nativeBefore - nativeAfter;
            if (withVerdict) {
                ++verdictsConsumed;
                delete _lastCalls;
                for (uint256 i; i < calls.length; ++i) {
                    _lastCalls.push(calls[i]);
                }
                _lastVerdict = v;
                _lastSig = sig;
                _hasLast = true;
            }
        } catch {
            ++agentBlocked;
        }

        uint256 nonceAfter = vault.verdictNonce();
        if (nonceAfter < nonceBefore) nonceDecreased = true;
        if (nonceAfter > maxNonceSeen) maxNonceSeen = nonceAfter;
    }

    function _sign(AgentVault.Call[] memory calls)
        internal
        view
        returns (AgentVault.Verdict memory v, bytes memory sig)
    {
        v = AgentVault.Verdict({
            callsHash: keccak256(abi.encode(calls)),
            nonce: vault.verdictNonce(),
            deadline: uint64(block.timestamp + 60),
            risk: 0,
            checkId: keccak256(abi.encode(block.timestamp, calls.length))
        });
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("Guardian402 AgentVault"), keccak256("1"), block.chainid, address(vault)
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(VERDICT_TYPEHASH, v.callsHash, v.nonce, v.deadline, v.risk, v.checkId));
        (uint8 r8, bytes32 r, bytes32 s) =
            vm.sign(GUARDIAN_PK, keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash)));
        sig = abi.encodePacked(r, s, r8);
    }

    function _transferCall(address to, uint256 amount) internal view returns (AgentVault.Call memory) {
        return AgentVault.Call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _single(AgentVault.Call memory c) internal pure returns (AgentVault.Call[] memory calls) {
        calls = new AgentVault.Call[](1);
        calls[0] = c;
    }
}

contract AgentVaultInvariantTest is AgentVaultBase {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, usdc, target, owner, agent, treasury, attacker);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = VaultHandler.agentTransfer.selector;
        selectors[1] = VaultHandler.agentNative.selector;
        selectors[2] = VaultHandler.agentSwapLike.selector;
        selectors[3] = VaultHandler.agentDrainToAttacker.selector;
        selectors[4] = VaultHandler.agentReplay.selector;
        selectors[5] = VaultHandler.agentForeignVerdict.selector;
        selectors[6] = VaultHandler.agentTriesAdmin.selector;
        selectors[7] = VaultHandler.ownerExecute.selector;
        selectors[8] = VaultHandler.ownerTopUp.selector;
        selectors[9] = VaultHandler.pause.selector;
        selectors[10] = VaultHandler.unpause.selector;
        selectors[11] = VaultHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// 1. Within any one day, agent-path outflow of each tracked token is ≤ its dailyCap; same for native.
    function invariant_DailyOutflowWithinCap() public view {
        uint256 n = handler.touchedDayCount();
        for (uint256 i; i < n; ++i) {
            uint256 day = handler.touchedDays(i);
            assertLe(handler.agentOutflow(address(usdc), day), USDC_CAP, "usdc outflow above cap");
            assertLe(handler.agentOutflow(address(0), day), NATIVE_CAP, "native outflow above cap");
            assertEq(vault.spent(address(usdc), day), handler.agentOutflow(address(usdc), day), "usdc spent drift");
            assertEq(vault.spent(address(0), day), handler.agentOutflow(address(0), day), "native spent drift");
        }
    }

    /// 2. The agent can never change owner, agent, guardian, policy or pause state.
    function invariant_AgentCannotChangeAdminState() public view {
        assertFalse(handler.agentChangedAdmin(), "agent called an owner function");
        assertEq(vault.owner(), owner);
        assertEq(vault.pendingOwner(), address(0));
        assertEq(vault.agent(), agent);
        assertEq(vault.guardian(), guardian);
        assertEq(vault.paused(), handler.ghostPaused(), "pause state changed outside the owner");
        assertEq(vault.maxAgentRisk(), 0);
        (bool tracked, uint256 cap, uint256 maxApproval, uint256 threshold) = vault.tokenPolicy(address(usdc));
        assertTrue(tracked);
        assertEq(cap, USDC_CAP);
        assertEq(maxApproval, USDC_MAX_APPROVAL);
        assertEq(threshold, USDC_THRESHOLD);
        assertEq(vault.nativeDailyCap(), NATIVE_CAP);
        assertEq(vault.nativeVerdictThreshold(), NATIVE_THRESHOLD);
        assertFalse(vault.allowedRecipient(attacker));
    }

    /// 3. While paused, the agent cannot move any funds.
    function invariant_PausedAgentMovesNothing() public view {
        assertFalse(handler.movedWhilePaused());
    }

    /// 4. A verdict can be used at most once (verdictNonce strictly increases).
    function invariant_VerdictUsedAtMostOnce() public view {
        assertFalse(handler.replayAccepted(), "replayed verdict accepted");
        assertFalse(handler.nonceDecreased(), "nonce decreased");
        assertEq(vault.verdictNonce(), handler.verdictsConsumed(), "nonce != verdicts consumed");
        assertEq(vault.verdictNonce(), handler.maxNonceSeen());
    }

    /// 5. The owner can always withdraw the full balance, paused or not.
    function invariant_OwnerCanWithdrawEverything() public {
        uint256 snapshot = vm.snapshotState();
        uint256 usdcBalance = usdc.balanceOf(address(vault));
        uint256 nativeBalance = address(vault).balance;
        uint256 ownerUsdc = usdc.balanceOf(owner);
        uint256 ownerNative = owner.balance;
        vm.startPrank(owner);
        vault.withdraw(address(usdc), owner, usdcBalance);
        vault.withdrawNative(payable(owner), nativeBalance);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(address(vault).balance, 0);
        assertEq(usdc.balanceOf(owner), ownerUsdc + usdcBalance);
        assertEq(owner.balance, ownerNative + nativeBalance);
        vm.revertToState(snapshot);
    }

    /// 6. A verdict issued for calls A can never authorize calls B.
    function invariant_VerdictBoundToCalls() public view {
        assertFalse(handler.foreignVerdictAccepted());
    }

    /// Not an invariant: shows that runs exercise both accepted and blocked agent batches.
    function afterInvariant() public view {
        console2.log("agent batches accepted / blocked:", handler.agentSucceeded(), handler.agentBlocked());
    }

    /// The allowlist holds: the attacker is never paid through the agent path.
    function invariant_AttackerNeverPaid() public view {
        assertFalse(handler.attackerPaid());
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(attacker.balance, 0);
    }
}
