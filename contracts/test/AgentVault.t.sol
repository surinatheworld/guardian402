// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockTarget} from "./mocks/MockTarget.sol";
import {ReentrantTarget} from "./mocks/ReentrantTarget.sol";
import {AgentVaultBase} from "./utils/AgentVaultBase.sol";

contract AgentVaultTest is AgentVaultBase {
    // ================================================================ step 1

    function test_RevertWhen_Paused() public {
        vm.prank(owner);
        vault.pause();
        vm.expectRevert(AgentVault.Paused.selector);
        _exec(_one(_transfer(treasury, 1)));
    }

    function test_RevertWhen_PausedCheckedBeforeCaller() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(attacker);
        vm.expectRevert(AgentVault.Paused.selector);
        vault.executeBatch(_one(_transfer(treasury, 1)), _noVerdict(), "");
    }

    function test_Unpause_RestoresAgentPath() public {
        vm.startPrank(owner);
        vault.pause();
        vault.unpause();
        vm.stopPrank();
        _exec(_one(_transfer(treasury, 1)));
        assertEq(usdc.balanceOf(treasury), 1);
    }

    function test_RevertWhen_NotAgent() public {
        vm.prank(attacker);
        vm.expectRevert(AgentVault.NotAgent.selector);
        vault.executeBatch(_one(_transfer(treasury, 1)), _noVerdict(), "");
    }

    function test_RevertWhen_OwnerUsesAgentPath() public {
        vm.prank(owner);
        vm.expectRevert(AgentVault.NotAgent.selector);
        vault.executeBatch(_one(_transfer(treasury, 1)), _noVerdict(), "");
    }

    function test_RevertWhen_AgentRevoked() public {
        vm.prank(owner);
        vault.setAgent(address(0));
        vm.expectRevert(AgentVault.NotAgent.selector);
        _exec(_one(_transfer(treasury, 1)));
    }

    function test_RevertWhen_EmptyBatch() public {
        vm.expectRevert(AgentVault.BadBatch.selector);
        _exec(new AgentVault.Call[](0));
    }

    function test_RevertWhen_BatchTooLong() public {
        AgentVault.Call[] memory calls = new AgentVault.Call[](9);
        for (uint256 i; i < 9; ++i) {
            calls[i] = _ping(0);
        }
        vm.expectRevert(AgentVault.BadBatch.selector);
        _exec(calls);
    }

    function test_MaxBatchLength() public {
        AgentVault.Call[] memory calls = new AgentVault.Call[](8);
        for (uint256 i; i < 8; ++i) {
            calls[i] = _ping(0);
        }
        _exec(calls);
        assertEq(target.pings(), 8);
    }

    // ================================================================ step 2

    function test_RevertWhen_TargetIsVault() public {
        AgentVault.Call memory c = AgentVault.Call(address(vault), 0, abi.encodeCall(AgentVault.pause, ()));
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(vault)));
        _exec(_one(c));
    }

    function test_RevertWhen_TargetIsZero() public {
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(0)));
        _exec(_one(_native(address(0), 0)));
    }

    function test_RevertWhen_TrackedTokenSelectorNotAllowed() public {
        AgentVault.Call memory c =
            AgentVault.Call(address(usdc), 0, abi.encodeCall(IERC20.transferFrom, (address(vault), treasury, 1)));
        vm.expectRevert(
            abi.encodeWithSelector(AgentVault.SelectorNotAllowed.selector, address(usdc), IERC20.transferFrom.selector)
        );
        _exec(_one(c));
    }

    function test_RevertWhen_TrackedTokenEmptyData() public {
        vm.expectRevert(abi.encodeWithSelector(AgentVault.SelectorNotAllowed.selector, address(usdc), bytes4(0)));
        _exec(_one(_native(address(usdc), 0)));
    }

    function test_RevertWhen_TrackedTokenShortData() public {
        AgentVault.Call memory c = AgentVault.Call(address(usdc), 0, hex"a905");
        vm.expectRevert(abi.encodeWithSelector(AgentVault.SelectorNotAllowed.selector, address(usdc), bytes4(0)));
        _exec(_one(c));
    }

    function test_RevertWhen_TrackedTokenCallHasExtraBytes() public {
        AgentVault.Call memory c = AgentVault.Call(
            address(usdc), 0, abi.encodePacked(abi.encodeCall(IERC20.transfer, (treasury, 1)), uint256(7))
        );
        vm.expectRevert(
            abi.encodeWithSelector(AgentVault.SelectorNotAllowed.selector, address(usdc), IERC20.transfer.selector)
        );
        _exec(_one(c));
    }

    function test_RevertWhen_TransferRecipientNotAllowed() public {
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RecipientNotAllowed.selector, attacker));
        _exec(_one(_transfer(attacker, 1)));
    }

    function test_RevertWhen_ApproveSpenderNotAllowed() public {
        _execWithVerdictExpectRevert(
            _one(_approve(attacker, 1)), 0, abi.encodeWithSelector(AgentVault.RecipientNotAllowed.selector, attacker)
        );
    }

    function test_RevertWhen_ApprovalTooLarge() public {
        _execWithVerdictExpectRevert(
            _one(_approve(address(target), USDC_MAX_APPROVAL + 1)),
            0,
            abi.encodeWithSelector(AgentVault.ApprovalTooLarge.selector, address(usdc), USDC_MAX_APPROVAL + 1)
        );
    }

    function test_RevertWhen_UnlimitedApproval() public {
        _execWithVerdictExpectRevert(
            _one(_approve(address(target), type(uint256).max)),
            0,
            abi.encodeWithSelector(AgentVault.ApprovalTooLarge.selector, address(usdc), type(uint256).max)
        );
    }

    function test_Approve_ExactlyMaxApprovalWithVerdict() public {
        _execWithVerdict(_one(_approve(address(target), USDC_MAX_APPROVAL)), 0);
        assertEq(usdc.allowance(address(vault), address(target)), USDC_MAX_APPROVAL);
    }

    function test_RevertWhen_ApproveWithoutVerdict() public {
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(_approve(address(target), 1)));
    }

    function test_Approve_ZeroIsAlwaysAllowedWithoutVerdict() public {
        _execWithVerdict(_one(_approve(address(target), 5e6)), 0);
        // Revocation needs no verdict and is allowed even for a spender outside the allowlist.
        _exec(_two(_approve(address(target), 0), _approve(attacker, 0)));
        assertEq(usdc.allowance(address(vault), address(target)), 0);
    }

    function test_RevertWhen_TargetNotAllowed() public {
        MockTarget other = new MockTarget();
        AgentVault.Call memory c = AgentVault.Call(address(other), 0, abi.encodeCall(MockTarget.ping, (1)));
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(other)));
        _exec(_one(c));
    }

    function test_RevertWhen_SelectorNotAllowed() public {
        vm.prank(owner);
        vault.setAllowedSelector(address(target), MockTarget.ping.selector, false);
        vm.expectRevert(
            abi.encodeWithSelector(AgentVault.SelectorNotAllowed.selector, address(target), MockTarget.ping.selector)
        );
        _exec(_one(_ping(0)));
    }

    function test_RevertWhen_TargetDataShorterThanSelector() public {
        AgentVault.Call memory c = AgentVault.Call(address(target), 0, hex"0102");
        vm.expectRevert(abi.encodeWithSelector(AgentVault.SelectorNotAllowed.selector, address(target), bytes4(0)));
        _exec(_one(c));
    }

    function test_RevertWhen_NativeToNonRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RecipientNotAllowed.selector, attacker));
        _exec(_one(_native(attacker, 1)));
    }

    function test_RevertWhen_ValueToTokenNotAllowed() public {
        AgentVault.Call memory c = _transfer(treasury, 1);
        c.value = 1;
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(usdc)));
        _exec(_one(c));
    }

    function test_Native_ToRecipientBelowThreshold() public {
        _exec(_one(_native(treasury, NATIVE_THRESHOLD)));
        assertEq(treasury.balance, NATIVE_THRESHOLD);
        assertEq(vault.spent(vault.NATIVE(), _today()), NATIVE_THRESHOLD);
    }

    function test_Native_ValueToAllowedTarget() public {
        _exec(_one(_ping(0.005 ether)));
        assertEq(target.lastValue(), 0.005 ether);
    }

    // ================================================================ step 3

    function test_Verdict_HappyPath() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectEmit(address(vault));
        emit AgentVault.Executed(_hash(calls), CHECK_ID, true, 0);
        _execSigned(calls, v, sig);
        assertEq(usdc.balanceOf(treasury), 5e6);
        assertEq(vault.verdictNonce(), 1);
    }

    function test_Verdict_OptionalVerdictStillConsumesNonce() public {
        _execWithVerdict(_one(_transfer(treasury, 1)), 0);
        assertEq(vault.verdictNonce(), 1);
    }

    function test_NoVerdict_EmitsExecuted() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 1));
        vm.expectEmit(address(vault));
        emit AgentVault.Executed(_hash(calls), bytes32(0), false, 0);
        _exec(calls);
        assertEq(vault.verdictNonce(), 0);
    }

    function test_RevertWhen_VerdictReplayed() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        _execSigned(calls, v, sig);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _execSigned(calls, v, sig);
    }

    function test_RevertWhen_VerdictNonceInFuture() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        v.nonce = 1;
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _execSigned(calls, v, sig);
    }

    function test_RevertWhen_VerdictForOtherCalls_TamperedTarget() public {
        AgentVault.Call[] memory signed = _one(_ping(0));
        AgentVault.Verdict memory v = _verdictFor(signed, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        MockTarget other = new MockTarget();
        vm.startPrank(owner);
        vault.setAllowedTarget(address(other), true);
        vault.setAllowedSelector(address(other), MockTarget.ping.selector, true);
        vm.stopPrank();
        AgentVault.Call[] memory sent = _one(_ping(0));
        sent[0].target = address(other);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _execSigned(sent, v, sig);
    }

    function test_RevertWhen_VerdictForOtherCalls_TamperedValue() public {
        AgentVault.Call[] memory signed = _one(_ping(0));
        AgentVault.Verdict memory v = _verdictFor(signed, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _execSigned(_one(_ping(1)), v, sig);
    }

    function test_RevertWhen_VerdictForOtherCalls_TamperedData() public {
        AgentVault.Call[] memory signed = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(signed, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _execSigned(_one(_transfer(treasury, 6e6)), v, sig);
    }

    function test_RevertWhen_VerdictForOtherCalls_ReorderedCalls() public {
        AgentVault.Call[] memory signed = _two(_approve(address(target), 2e6), _pull(2e6));
        AgentVault.Verdict memory v = _verdictFor(signed, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _execSigned(_two(_pull(2e6), _approve(address(target), 2e6)), v, sig);
    }

    function test_RevertWhen_VerdictCallsHashTampered() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        v.callsHash = bytes32(uint256(v.callsHash) ^ 1);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _execSigned(calls, v, sig);
    }

    function test_RevertWhen_VerdictExpired() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.warp(uint256(v.deadline) + 1);
        vm.expectRevert(AgentVault.VerdictExpired.selector);
        _execSigned(calls, v, sig);
    }

    function test_Verdict_ValidAtExactDeadline() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.warp(v.deadline);
        _execSigned(calls, v, sig);
        assertEq(usdc.balanceOf(treasury), 5e6);
    }

    function test_RevertWhen_WrongSigner() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(0xBAD, v);
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, sig);
    }

    function test_RevertWhen_MalformedSignature() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, hex"deadbeef");
    }

    function test_RevertWhen_SignedFieldTampered_Risk() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 2);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        v.risk = 0; // the agent lowers the risk the Guardian signed
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, sig);
    }

    function test_RevertWhen_SignedFieldTampered_DeadlineAndCheckId() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        v.deadline += 3600;
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, sig);
        v.deadline -= 3600;
        v.checkId = keccak256("other");
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, sig);
    }

    function test_RevertWhen_GuardianRotated() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.prank(owner);
        vault.setGuardian(makeAddr("newGuardian"));
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, sig);
    }

    function test_RevertWhen_GuardianUnset() public {
        vm.prank(owner);
        vault.setGuardian(address(0));
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, _signWith(GUARDIAN_PK, v));
        // Batches that need no verdict still run.
        _exec(_one(_transfer(treasury, 1)));
    }

    function test_RevertWhen_RiskAboveMax() public {
        _execWithVerdictExpectRevert(
            _one(_transfer(treasury, 5e6)), 1, abi.encodeWithSelector(AgentVault.RiskTooHigh.selector, uint8(1))
        );
        _execWithVerdictExpectRevert(
            _one(_transfer(treasury, 5e6)), 2, abi.encodeWithSelector(AgentVault.RiskTooHigh.selector, uint8(2))
        );
    }

    function test_Risk_MediumAcceptedWhenMaxRaised() public {
        vm.prank(owner);
        vault.setMaxAgentRisk(1);
        _execWithVerdict(_one(_transfer(treasury, 5e6)), 1);
        _execWithVerdictExpectRevert(
            _one(_transfer(treasury, 5e6)), 2, abi.encodeWithSelector(AgentVault.RiskTooHigh.selector, uint8(2))
        );
    }

    function test_FailedBatchDoesNotConsumeNonce() public {
        AgentVault.Call[] memory calls = _two(_transfer(treasury, 5e6), _transfer(treasury, 16e6));
        _execWithVerdictExpectRevert(
            calls, 0, abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(usdc), 21e6, USDC_CAP)
        );
        assertEq(vault.verdictNonce(), 0);
    }

    // ============================================================ steps 4–7

    function test_Threshold_ExactlyAtThresholdNeedsNoVerdict() public {
        _exec(_one(_transfer(treasury, USDC_THRESHOLD)));
        assertEq(usdc.balanceOf(treasury), USDC_THRESHOLD);
    }

    function test_RevertWhen_OneUnitAboveThresholdWithoutVerdict() public {
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(_transfer(treasury, USDC_THRESHOLD + 1)));
    }

    function test_Threshold_AboveThresholdWithVerdict() public {
        _execWithVerdict(_one(_transfer(treasury, USDC_THRESHOLD + 1)), 0);
        assertEq(usdc.balanceOf(treasury), USDC_THRESHOLD + 1);
    }

    function test_Threshold_AppliesPerBatchOutflow() public {
        // Two transfers at the threshold add up to more than it, so the batch needs a verdict.
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_two(_transfer(treasury, USDC_THRESHOLD), _transfer(treasury, USDC_THRESHOLD)));
    }

    function test_NativeThreshold_Boundaries() public {
        _exec(_one(_native(treasury, NATIVE_THRESHOLD)));
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(_native(treasury, NATIVE_THRESHOLD + 1)));
        _execWithVerdict(_one(_native(treasury, NATIVE_THRESHOLD + 1)), 0);
        assertEq(treasury.balance, 2 * NATIVE_THRESHOLD + 1);
    }

    function test_SwapLikeBatch_ApproveAndPull() public {
        _execWithVerdict(_two(_approve(address(target), 2e6), _pull(2e6)), 0);
        assertEq(usdc.balanceOf(address(target)), 2e6);
        assertEq(vault.spent(address(usdc), _today()), 2e6);
    }

    function test_InflowIsNotCountedAsOutflow() public {
        usdc.mint(address(target), 3e6);
        _exec(_one(_refund(3e6)));
        assertEq(vault.spent(address(usdc), _today()), 0);
        assertEq(usdc.balanceOf(address(vault)), VAULT_USDC + 3e6);
    }

    function test_DailyCap_ExactlyAtCap() public {
        _execWithVerdict(_one(_transfer(treasury, USDC_CAP)), 0);
        assertEq(vault.remainingToday(address(usdc)), 0);
    }

    function test_RevertWhen_DailyCapExceededInOneBatch() public {
        _execWithVerdictExpectRevert(
            _one(_transfer(treasury, USDC_CAP + 1)),
            0,
            abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(usdc), USDC_CAP + 1, USDC_CAP)
        );
    }

    function test_RevertWhen_DailyCapExceededAcrossBatches() public {
        _execWithVerdict(_one(_transfer(treasury, 10e6)), 0);
        _execWithVerdict(_one(_transfer(treasury, 9e6)), 0);
        _exec(_one(_transfer(treasury, 1e6)));
        vm.expectRevert(
            abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(usdc), USDC_CAP + 1, USDC_CAP)
        );
        _exec(_one(_transfer(treasury, 1)));
    }

    function test_DailyCap_ResetsOnNextDay() public {
        _execWithVerdict(_one(_transfer(treasury, USDC_CAP)), 0);
        uint256 dayOne = _today();
        vm.warp((dayOne + 1) * 1 days); // first second of the next day
        _execWithVerdict(_one(_transfer(treasury, USDC_CAP)), 0);
        assertEq(vault.spent(address(usdc), dayOne), USDC_CAP);
        assertEq(vault.spent(address(usdc), dayOne + 1), USDC_CAP);
    }

    function test_DailyCap_LastSecondOfDayStillSameDay() public {
        uint256 day = _today();
        _execWithVerdict(_one(_transfer(treasury, USDC_CAP)), 0);
        vm.warp((day + 1) * 1 days - 1);
        vm.expectRevert(
            abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(usdc), USDC_CAP + 1, USDC_CAP)
        );
        _exec(_one(_transfer(treasury, 1)));
    }

    function test_RevertWhen_NativeDailyCapExceeded() public {
        _execWithVerdictExpectRevert(
            _one(_native(treasury, NATIVE_CAP + 1)),
            0,
            abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(0), NATIVE_CAP + 1, NATIVE_CAP)
        );
    }

    function test_RevertWhen_CallFails() public {
        AgentVault.Call memory failing = AgentVault.Call(address(target), 0, abi.encodeCall(MockTarget.fail, (7)));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentVault.CallFailed.selector, 1, abi.encodeWithSelector(MockTarget.Boom.selector, 7)
            )
        );
        _exec(_two(_transfer(treasury, 1), failing));
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_RevertWhen_PullWithoutApprovalFails() public {
        AgentVault.Call[] memory calls = _one(_pull(1));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectRevert(); // CallFailed(0, ERC20InsufficientAllowance(...))
        _execSigned(calls, v, sig);
    }

    function test_UntrackedTokenMovesNeedAllowedTarget() public {
        MockUSDC other = new MockUSDC();
        other.mint(address(vault), 5e6);
        AgentVault.Call memory c = AgentVault.Call(address(other), 0, abi.encodeCall(IERC20.transfer, (attacker, 5e6)));
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(other)));
        _exec(_one(c));
    }

    // ======================================================== reentrancy

    function test_Reentrancy_AgentReentersExecuteBatch() public {
        ReentrantTarget evil = _evilAsTarget(ReentrantTarget.Mode.ExecuteBatch);
        vm.prank(owner);
        vault.setAgent(address(evil));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentVault.CallFailed.selector,
                0,
                abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
            )
        );
        evil.start();
    }

    function test_Reentrancy_OwnerExecuteReentry() public {
        ReentrantTarget evil = _evilAsTarget(ReentrantTarget.Mode.OwnerExecute);
        vm.prank(owner);
        vault.transferOwnership(address(evil));
        vm.prank(address(evil));
        vault.acceptOwnership();
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentVault.CallFailed.selector,
                0,
                abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
            )
        );
        evil.start();
    }

    function test_Reentrancy_TargetCannotWithdraw() public {
        ReentrantTarget evil = _evilAsTarget(ReentrantTarget.Mode.Withdraw);
        AgentVault.Call memory c = AgentVault.Call(address(evil), 0, abi.encodeCall(ReentrantTarget.attack, ()));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentVault.CallFailed.selector,
                0,
                abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(evil))
            )
        );
        _exec(_one(c));
        assertEq(address(vault).balance, VAULT_NATIVE);
    }

    function test_Reentrancy_TargetCannotChangeAgent() public {
        ReentrantTarget evil = _evilAsTarget(ReentrantTarget.Mode.SetAgent);
        AgentVault.Call memory c = AgentVault.Call(address(evil), 0, abi.encodeCall(ReentrantTarget.attack, ()));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentVault.CallFailed.selector,
                0,
                abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(evil))
            )
        );
        _exec(_one(c));
        assertEq(vault.agent(), agent);
    }

    function _evilAsTarget(ReentrantTarget.Mode mode) internal returns (ReentrantTarget evil) {
        evil = new ReentrantTarget(vault);
        evil.setMode(mode);
        vm.startPrank(owner);
        vault.setAllowedTarget(address(evil), true);
        vault.setAllowedSelector(address(evil), ReentrantTarget.attack.selector, true);
        vm.stopPrank();
    }

    // ======================================================== owner path

    function test_OwnerExecute_BypassesPolicy() public {
        AgentVault.Call[] memory calls = _one(_transfer(attacker, VAULT_USDC));
        vm.expectEmit(address(vault));
        emit AgentVault.OwnerExecuted(_hash(calls), 1);
        vm.prank(owner);
        vault.ownerExecute(calls);
        assertEq(usdc.balanceOf(attacker), VAULT_USDC);
        assertEq(vault.spent(address(usdc), _today()), 0);
    }

    function test_OwnerExecute_WorksWhilePaused() public {
        vm.startPrank(owner);
        vault.pause();
        vault.ownerExecute(_one(_native(owner, 1 ether)));
        vm.stopPrank();
        assertEq(owner.balance, 1 ether);
    }

    function test_RevertWhen_OwnerExecuteCallFails() public {
        AgentVault.Call memory failing = AgentVault.Call(address(target), 0, abi.encodeCall(MockTarget.fail, (3)));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentVault.CallFailed.selector, 0, abi.encodeWithSelector(MockTarget.Boom.selector, 3)
            )
        );
        vm.prank(owner);
        vault.ownerExecute(_one(failing));
    }

    function test_Withdraw_FullBalanceWhilePaused() public {
        vm.startPrank(owner);
        vault.pause();
        vm.expectEmit(address(vault));
        emit AgentVault.Withdrawn(address(usdc), owner, VAULT_USDC);
        vault.withdraw(address(usdc), owner, VAULT_USDC);
        vm.expectEmit(address(vault));
        emit AgentVault.NativeWithdrawn(owner, VAULT_NATIVE);
        vault.withdrawNative(payable(owner), VAULT_NATIVE);
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), VAULT_USDC);
        assertEq(owner.balance, VAULT_NATIVE);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(address(vault).balance, 0);
    }

    function test_RevertWhen_NonOwnerCallsOwnerFunctions() public {
        address[2] memory callers = [agent, attacker];
        for (uint256 i; i < callers.length; ++i) {
            address who = callers[i];
            bytes[] memory payloads = _ownerPayloads();
            for (uint256 j; j < payloads.length; ++j) {
                vm.prank(who);
                (bool ok, bytes memory ret) = address(vault).call(payloads[j]);
                assertFalse(ok);
                assertEq(ret, abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who));
            }
        }
    }

    function _ownerPayloads() internal view returns (bytes[] memory p) {
        AgentVault.Call[] memory calls = _one(_transfer(attacker, 1));
        p = new bytes[](14);
        p[0] = abi.encodeCall(AgentVault.ownerExecute, (calls));
        p[1] = abi.encodeCall(AgentVault.withdraw, (address(usdc), attacker, 1));
        p[2] = abi.encodeCall(AgentVault.withdrawNative, (payable(attacker), 1));
        p[3] = abi.encodeCall(AgentVault.pause, ());
        p[4] = abi.encodeCall(AgentVault.unpause, ());
        p[5] = abi.encodeCall(AgentVault.setAgent, (attacker));
        p[6] = abi.encodeCall(AgentVault.setGuardian, (attacker));
        p[7] = abi.encodeCall(AgentVault.setMaxAgentRisk, (2));
        p[8] = abi.encodeCall(AgentVault.setTokenPolicy, (address(usdc), true, type(uint256).max, 0, 0));
        p[9] = abi.encodeCall(AgentVault.setNativePolicy, (type(uint256).max, type(uint256).max));
        p[10] = abi.encodeCall(AgentVault.setAllowedTarget, (attacker, true));
        p[11] = abi.encodeCall(AgentVault.setAllowedSelector, (attacker, bytes4(0x12345678), true));
        p[12] = abi.encodeCall(AgentVault.setAllowedRecipient, (attacker, true));
        p[13] = abi.encodeCall(Ownable.transferOwnership, (attacker));
    }

    function test_SetAgent_EmitsAndUpdates() public {
        address next = makeAddr("nextAgent");
        vm.expectEmit(address(vault));
        emit AgentVault.AgentSet(agent, next);
        vm.prank(owner);
        vault.setAgent(next);
        assertEq(vault.agent(), next);
    }

    function test_SetGuardian_NewGuardianSigns() public {
        uint256 newPk = 0xC0FFEE;
        vm.prank(owner);
        vault.setGuardian(vm.addr(newPk));
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        _execSigned(calls, v, _signWith(newPk, v));
        assertEq(usdc.balanceOf(treasury), 5e6);
    }

    function test_RevertWhen_MaxAgentRiskAboveHigh() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RiskTooHigh.selector, uint8(3)));
        vault.setMaxAgentRisk(3);
    }

    function test_SetMaxAgentRisk_Emits() public {
        vm.expectEmit(address(vault));
        emit AgentVault.MaxAgentRiskSet(2);
        vm.prank(owner);
        vault.setMaxAgentRisk(2);
        assertEq(vault.maxAgentRisk(), 2);
    }

    function test_RevertWhen_TokenPolicyForNativeKeyOrVault() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(0)));
        vault.setTokenPolicy(address(0), true, 1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(vault)));
        vault.setTokenPolicy(address(vault), true, 1, 1, 1);
        vm.stopPrank();
    }

    function test_TokenPolicy_UpdateDoesNotDuplicate() public {
        vm.expectEmit(address(vault));
        emit AgentVault.TokenPolicySet(address(usdc), true, 5e6, 2e6, 1e6);
        vm.prank(owner);
        vault.setTokenPolicy(address(usdc), true, 5e6, 2e6, 1e6);
        assertEq(vault.trackedTokenCount(), 1);
        (bool tracked, uint256 cap, uint256 maxApproval, uint256 threshold) = vault.tokenPolicy(address(usdc));
        assertTrue(tracked);
        assertEq(cap, 5e6);
        assertEq(maxApproval, 2e6);
        assertEq(threshold, 1e6);
    }

    function test_RevertWhen_TooManyTrackedTokens() public {
        vm.startPrank(owner);
        for (uint256 i; i < 7; ++i) {
            vault.setTokenPolicy(address(new MockUSDC()), true, 1, 1, 1);
        }
        assertEq(vault.trackedTokenCount(), 8);
        address ninth = address(new MockUSDC());
        vm.expectRevert(AgentVault.TooManyTrackedTokens.selector);
        vault.setTokenPolicy(ninth, true, 1, 1, 1);
        vm.stopPrank();
    }

    function test_Untrack_RemovesTokenAndItsShortcut() public {
        address a = address(new MockUSDC());
        address b = address(new MockUSDC());
        vm.startPrank(owner);
        vault.setTokenPolicy(a, true, 1, 1, 1);
        vault.setTokenPolicy(b, true, 1, 1, 1);
        vault.setTokenPolicy(address(usdc), false, 0, 0, 0); // first element: swap with last
        vault.setTokenPolicy(a, false, 0, 0, 0);
        vault.setTokenPolicy(b, false, 0, 0, 0); // only element left
        vm.stopPrank();
        assertEq(vault.trackedTokenCount(), 0);
        // An untracked token is no longer a transfer/approve shortcut.
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(usdc)));
        _exec(_one(_transfer(treasury, 1)));
    }

    function test_Untrack_KeepsSpentHistory() public {
        _execWithVerdict(_one(_transfer(treasury, 15e6)), 0);
        vm.startPrank(owner);
        vault.setTokenPolicy(address(usdc), false, 0, 0, 0);
        vault.setTokenPolicy(address(usdc), true, USDC_CAP, USDC_MAX_APPROVAL, USDC_THRESHOLD);
        vm.stopPrank();
        _execWithVerdictExpectRevert(
            _one(_transfer(treasury, 6e6)),
            0,
            abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(usdc), 21e6, USDC_CAP)
        );
    }

    function test_AllowlistSetters_ToggleOff() public {
        vm.startPrank(owner);
        vm.expectEmit(address(vault));
        emit AgentVault.AllowedTargetSet(address(target), false);
        vault.setAllowedTarget(address(target), false);
        vm.expectEmit(address(vault));
        emit AgentVault.AllowedRecipientSet(treasury, false);
        vault.setAllowedRecipient(treasury, false);
        vm.expectEmit(address(vault));
        emit AgentVault.AllowedSelectorSet(address(target), MockTarget.fail.selector, false);
        vault.setAllowedSelector(address(target), MockTarget.fail.selector, false);
        vm.stopPrank();
        assertFalse(vault.allowedTarget(address(target)));
        assertFalse(vault.allowedRecipient(treasury));
        assertFalse(vault.allowedSelector(address(target), MockTarget.fail.selector));
        assertTrue(vault.allowedSelector(address(target), MockTarget.ping.selector));
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RecipientNotAllowed.selector, treasury));
        _exec(_one(_transfer(treasury, 1)));
    }

    function test_NativePolicy_Emits() public {
        vm.expectEmit(address(vault));
        emit AgentVault.NativePolicySet(1 ether, 0);
        vm.prank(owner);
        vault.setNativePolicy(1 ether, 0);
        assertEq(vault.nativeDailyCap(), 1 ether);
        assertEq(vault.nativeVerdictThreshold(), 0);
    }

    function test_RevertWhen_RenounceOwnership() public {
        vm.prank(owner);
        vm.expectRevert(AgentVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);
    }

    function test_Ownable2Step_Transfer() public {
        address next = makeAddr("teamLead");
        vm.prank(owner);
        vault.transferOwnership(next);
        assertEq(vault.owner(), owner);
        assertEq(vault.pendingOwner(), next);
        vm.prank(next);
        vault.acceptOwnership();
        assertEq(vault.owner(), next);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vault.pause();
    }

    function test_ReceiveAcceptsNative() public {
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        (bool ok,) = address(vault).call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, VAULT_NATIVE + 0.5 ether);
    }

    function test_RevertWhen_ConstructorZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new AgentVault(address(0), agent, guardian);
    }

    // ============================================================== views

    function test_VerdictDigest_MatchesIndependentDigest() public view {
        AgentVault.Verdict memory v = AgentVault.Verdict({
            callsHash: keccak256("calls"), nonce: 7, deadline: 1_800_000_000, risk: 1, checkId: keccak256("id")
        });
        assertEq(vault.verdictDigest(v), _digest(v));
    }

    function test_Eip712Domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            vault.eip712Domain();
        assertEq(name, "Guardian402 AgentVault");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(vault));
        assertEq(
            vault.VERDICT_TYPEHASH(),
            keccak256("Verdict(bytes32 callsHash,uint256 nonce,uint64 deadline,uint8 risk,bytes32 checkId)")
        );
    }

    function test_HashCalls_MatchesAbiEncode() public view {
        AgentVault.Call[] memory calls = _two(_approve(address(target), 2e6), _pull(2e6));
        assertEq(vault.hashCalls(calls), keccak256(abi.encode(calls)));
    }

    function test_RemainingToday() public {
        assertEq(vault.remainingToday(address(usdc)), USDC_CAP);
        assertEq(vault.remainingToday(address(0)), NATIVE_CAP);
        assertEq(vault.remainingToday(attacker), 0); // not tracked
        _execWithVerdict(_one(_transfer(treasury, 7e6)), 0);
        _exec(_one(_native(treasury, 0.004 ether)));
        assertEq(vault.remainingToday(address(usdc)), USDC_CAP - 7e6);
        assertEq(vault.remainingToday(address(0)), NATIVE_CAP - 0.004 ether);
        vm.prank(owner);
        vault.setTokenPolicy(address(usdc), true, 5e6, USDC_MAX_APPROVAL, USDC_THRESHOLD); // cap now below spent
        assertEq(vault.remainingToday(address(usdc)), 0);
    }

    function test_GetPolicy() public {
        _execWithVerdict(_one(_transfer(treasury, 3e6)), 0);
        AgentVault.Policy memory p = vault.getPolicy();
        assertEq(p.owner, owner);
        assertEq(p.pendingOwner, address(0));
        assertEq(p.agent, agent);
        assertEq(p.guardian, guardian);
        assertFalse(p.paused);
        assertEq(p.verdictNonce, 1);
        assertEq(p.maxAgentRisk, 0);
        assertEq(p.day, _today());

        assertEq(p.tokens.length, 1);
        assertEq(p.tokens[0].token, address(usdc));
        assertEq(p.tokens[0].dailyCap, USDC_CAP);
        assertEq(p.tokens[0].maxApproval, USDC_MAX_APPROVAL);
        assertEq(p.tokens[0].verdictThreshold, USDC_THRESHOLD);
        assertEq(p.tokens[0].spentToday, 3e6);
        assertEq(p.tokens[0].balance, VAULT_USDC - 3e6);

        assertEq(p.nativeDailyCap, NATIVE_CAP);
        assertEq(p.nativeVerdictThreshold, NATIVE_THRESHOLD);
        assertEq(p.nativeSpentToday, 0);
        assertEq(p.nativeBalance, VAULT_NATIVE);

        assertEq(p.targets.length, 1);
        assertEq(p.targets[0].target, address(target));
        assertEq(p.targets[0].selectors.length, 4);
        assertEq(p.targets[0].selectors[0], MockTarget.ping.selector);
        assertEq(p.targets[0].selectors[3], MockTarget.fail.selector);

        assertEq(p.recipients.length, 2);
        assertEq(p.recipients[0], address(target));
        assertEq(p.recipients[1], treasury);
    }
}
