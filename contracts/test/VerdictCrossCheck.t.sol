// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockTarget} from "./mocks/MockTarget.sol";

/// SPEC §5 cross-check: a verdict signed in TypeScript (scripts/gen-verdict-fixture.ts, using
/// packages/shared) must be accepted by AgentVault byte for byte, and every mutation must be rejected.
contract VerdictCrossCheckTest is Test {
    using stdJson for string;

    string internal json;
    AgentVault internal vault;
    MockUSDC internal token;
    MockTarget internal target;
    address internal agent;

    AgentVault.Call[] internal calls;
    AgentVault.Verdict internal verdict;
    bytes internal signature;

    function setUp() public {
        json = vm.readFile("./test/fixtures/verdict.json");
        vm.chainId(json.readUint(".chainId"));
        vm.warp(json.readUint(".timestamp"));

        address deployer = json.readAddress(".deployer");
        address owner = json.readAddress(".owner");
        agent = json.readAddress(".agent");

        // Deterministic addresses: the fixed deployer creates vault, token and target at nonces 0, 1 and 2.
        vm.setNonce(deployer, 0);
        vm.startPrank(deployer);
        AgentVault.Config memory emptyConfig;
        vault = new AgentVault(owner, agent, json.readAddress(".signer"), emptyConfig);
        token = new MockUSDC();
        target = new MockTarget();
        vm.stopPrank();
        assertEq(address(vault), vm.computeCreateAddress(deployer, 0), "vault not at nonce 0");
        assertEq(address(vault), json.readAddress(".vault"), "vault address differs from TypeScript");
        assertEq(address(token), json.readAddress(".token"));
        assertEq(address(target), json.readAddress(".target"));

        vm.startPrank(owner);
        vault.setTokenPolicy(address(token), true, 20e6, 10e6, 1e6);
        vault.setNativePolicy(0.1 ether, 0.01 ether);
        vault.setAllowedTarget(address(target), true);
        vault.setAllowedSelector(address(target), MockTarget.pull.selector, true);
        vault.setAllowedSelector(address(target), MockTarget.ping.selector, true);
        vault.setAllowedRecipient(address(target), true);
        vm.stopPrank();
        token.mint(address(vault), 50e6);
        vm.deal(address(vault), 1 ether);

        AgentVault.Call[] memory decoded = abi.decode(json.readBytes(".callsEncoded"), (AgentVault.Call[]));
        for (uint256 i; i < decoded.length; ++i) {
            calls.push(decoded[i]);
        }
        verdict = AgentVault.Verdict({
            callsHash: json.readBytes32(".verdict.callsHash"),
            nonce: json.readUint(".verdict.nonce"),
            deadline: uint64(json.readUint(".verdict.deadline")),
            risk: uint8(json.readUint(".verdict.risk")),
            checkId: json.readBytes32(".verdict.checkId")
        });
        signature = json.readBytes(".signature");
    }

    function _exec(AgentVault.Call[] memory c, AgentVault.Verdict memory v, bytes memory sig) internal {
        vm.prank(agent);
        vault.executeBatch(c, v, sig);
    }

    function _calls() internal view returns (AgentVault.Call[] memory c) {
        c = calls;
    }

    // ------------------------------------------------------------------ accept

    function test_EncodingMatchesTypeScript() public view {
        assertEq(calls.length, 3);
        assertEq(vault.hashCalls(calls), verdict.callsHash, "hashCalls differs");
        assertEq(vault.verdictDigest(verdict), json.readBytes32(".digest"), "EIP-712 digest differs");
    }

    function test_AcceptsTypeScriptVerdict() public {
        vm.expectEmit(address(vault));
        emit AgentVault.Executed(verdict.callsHash, verdict.checkId, true, 0);
        _exec(_calls(), verdict, signature);
        assertEq(vault.verdictNonce(), 1);
        assertEq(token.balanceOf(address(target)), 2e6);
        assertEq(target.lastValue(), 1000);
    }

    // ---------------------------------------------------------- verdict fields

    function test_RejectsMutatedCallsHash() public {
        AgentVault.Verdict memory v = verdict;
        v.callsHash = bytes32(uint256(v.callsHash) ^ 1);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _exec(_calls(), v, signature);
    }

    function test_RejectsMutatedNonce() public {
        AgentVault.Verdict memory v = verdict;
        v.nonce = 1;
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _exec(_calls(), v, signature);
    }

    function test_RejectsMutatedDeadline() public {
        AgentVault.Verdict memory v = verdict;
        v.deadline += 1;
        vm.expectRevert(AgentVault.BadSignature.selector);
        _exec(_calls(), v, signature);
    }

    function test_RejectsExpiredVerdict() public {
        vm.warp(uint256(verdict.deadline) + 1);
        vm.expectRevert(AgentVault.VerdictExpired.selector);
        _exec(_calls(), verdict, signature);
    }

    function test_RejectsMutatedRisk() public {
        AgentVault.Verdict memory v = verdict;
        v.risk = 1;
        vm.expectRevert(AgentVault.BadSignature.selector);
        _exec(_calls(), v, signature);
    }

    function test_RejectsMutatedCheckId() public {
        AgentVault.Verdict memory v = verdict;
        v.checkId = bytes32(uint256(v.checkId) ^ 1);
        vm.expectRevert(AgentVault.BadSignature.selector);
        _exec(_calls(), v, signature);
    }

    function test_RejectsMutatedSignature() public {
        bytes memory sig = bytes.concat(signature);
        sig[10] = bytes1(uint8(sig[10]) ^ 0x01);
        vm.expectRevert(AgentVault.BadSignature.selector);
        _exec(_calls(), verdict, sig);
    }

    function test_RejectsOtherChain() public {
        vm.chainId(43114);
        vm.expectRevert(AgentVault.BadSignature.selector);
        _exec(_calls(), verdict, signature);
    }

    function test_RejectsReplay() public {
        _exec(_calls(), verdict, signature);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _exec(_calls(), verdict, signature);
    }

    // ------------------------------------------------------------------ calls

    /// One byte of each call: the last byte of its calldata (an amount or argument, so static policy still
    /// passes and the verdict check is what rejects it).
    function test_RejectsOneByteChangeInEachCall() public {
        for (uint256 i; i < calls.length; ++i) {
            AgentVault.Call[] memory c = _calls();
            bytes memory data = bytes.concat(c[i].data);
            data[data.length - 1] = bytes1(uint8(data[data.length - 1]) ^ 0x01);
            c[i].data = data;
            vm.expectRevert(AgentVault.InvalidVerdict.selector);
            _exec(c, verdict, signature);
        }
    }

    function test_RejectsMutatedValue() public {
        AgentVault.Call[] memory c = _calls();
        c[2].value += 1;
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _exec(c, verdict, signature);
    }

    function test_RejectsMutatedTarget() public {
        MockTarget other = new MockTarget();
        vm.startPrank(vault.owner());
        vault.setAllowedTarget(address(other), true);
        vault.setAllowedSelector(address(other), MockTarget.ping.selector, true);
        vm.stopPrank();
        AgentVault.Call[] memory c = _calls();
        c[2].target = address(other);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _exec(c, verdict, signature);
    }

    function test_RejectsReorderedCalls() public {
        AgentVault.Call[] memory c = _calls();
        (c[1], c[2]) = (c[2], c[1]);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _exec(c, verdict, signature);
    }

    function test_RejectsDroppedCall() public {
        AgentVault.Call[] memory c = new AgentVault.Call[](2);
        c[0] = calls[0];
        c[1] = calls[1];
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _exec(c, verdict, signature);
    }
}
