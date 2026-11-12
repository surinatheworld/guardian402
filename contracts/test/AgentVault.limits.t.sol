// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockTarget} from "./mocks/MockTarget.sol";
import {AgentVaultBase} from "./utils/AgentVaultBase.sol";

/// Per-batch cap (`maxPerTx`), running budget (`budget`, `resetBudget`) and the constructor config (SPEC §4.9).
contract AgentVaultLimitsTest is AgentVaultBase {
    event LimitsSet(address indexed token, uint256 maxPerTx, uint256 budget);
    event BudgetReset(address indexed token);

    address internal constant NATIVE = address(0);

    function _setLimits(address token, uint256 maxPerTx, uint256 budget) internal {
        vm.prank(owner);
        vault.setLimits(token, maxPerTx, budget);
    }

    // ============================================================ defaults

    function test_DefaultsAreUnlimited() public view {
        (uint256 maxPerTx, uint256 budget) = vault.limits(address(usdc));
        assertEq(maxPerTx, 0);
        assertEq(budget, 0);
        assertEq(vault.remainingBudget(address(usdc)), type(uint256).max);
        assertEq(vault.remainingBudget(NATIVE), type(uint256).max);
    }

    function test_NoLimitsKeepsDailyCapBehaviour() public {
        _execWithVerdict(_one(_transfer(treasury, 8e6)), 0);
        _execWithVerdict(_one(_transfer(treasury, 8e6)), 0);
        assertEq(vault.spentSinceReset(address(usdc)), 16e6, "counted even without a budget");
    }

    // ========================================================== maxPerTx

    function test_MaxPerTx_AllowsUpToCap() public {
        _setLimits(address(usdc), 5e6, 0);
        _execWithVerdict(_one(_transfer(treasury, 5e6)), 0);
        assertEq(usdc.balanceOf(treasury), 5e6);
    }

    function test_RevertWhen_MaxPerTxExceeded_EvenWithVerdict() public {
        _setLimits(address(usdc), 5e6, 0);
        _execWithVerdictExpectRevert(
            _one(_transfer(treasury, 5e6 + 1)),
            0,
            abi.encodeWithSelector(AgentVault.TxCapExceeded.selector, address(usdc), 5e6 + 1, 5e6)
        );
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(vault.spent(address(usdc), _today()), 0, "failed batch leaves no spend");
    }

    function test_RevertWhen_MaxPerTxExceededAcrossCallsOfOneBatch() public {
        _setLimits(address(usdc), 5e6, 0);
        _execWithVerdictExpectRevert(
            _two(_transfer(treasury, 3e6), _transfer(treasury, 3e6)),
            0,
            abi.encodeWithSelector(AgentVault.TxCapExceeded.selector, address(usdc), 6e6, 5e6)
        );
    }

    function test_MaxPerTx_CountsNetOutflowOfASwapLikeBatch() public {
        _setLimits(address(usdc), 5e6, 0);
        usdc.mint(address(target), 10e6);
        AgentVault.Call[] memory calls = new AgentVault.Call[](3);
        calls[0] = _approve(address(target), 8e6);
        calls[1] = _pull(8e6);
        calls[2] = _refund(4e6);
        _execWithVerdict(calls, 0); // net outflow 4 USDC <= 5
        assertEq(vault.spentSinceReset(address(usdc)), 4e6);
    }

    function test_RevertWhen_NativeMaxPerTxExceeded() public {
        _setLimits(NATIVE, 0.02 ether, 0);
        _execWithVerdictExpectRevert(
            _one(_native(treasury, 0.03 ether)),
            0,
            abi.encodeWithSelector(AgentVault.TxCapExceeded.selector, NATIVE, 0.03 ether, 0.02 ether)
        );
        _execWithVerdict(_one(_native(treasury, 0.02 ether)), 0);
        assertEq(treasury.balance, 0.02 ether);
    }

    // ============================================================ budget

    function test_Budget_SpansDaysUntilReset() public {
        _setLimits(address(usdc), 0, 25e6);
        _execWithVerdict(_one(_transfer(treasury, 15e6)), 0);
        vm.warp(vm.getBlockTimestamp() + 1 days); // daily cap resets, budget does not
        _execWithVerdict(_one(_transfer(treasury, 10e6)), 0);
        assertEq(vault.remainingBudget(address(usdc)), 0);

        _execWithVerdictExpectRevert(
            _one(_transfer(treasury, 1)),
            0,
            abi.encodeWithSelector(AgentVault.BudgetExceeded.selector, address(usdc), 25e6 + 1, 25e6)
        );

        vm.expectEmit(true, false, false, false, address(vault));
        emit BudgetReset(address(usdc));
        vm.prank(owner);
        vault.resetBudget(address(usdc));
        assertEq(vault.remainingBudget(address(usdc)), 25e6);
        _execWithVerdict(_one(_transfer(treasury, 1e6)), 0);
        assertEq(usdc.balanceOf(treasury), 26e6);
    }

    function test_RevertWhen_BudgetExceededBySmallTransferWithoutVerdict() public {
        _setLimits(address(usdc), 0, 1.5e6);
        _exec(_one(_transfer(treasury, 1e6))); // at the verdict threshold: no verdict needed
        vm.expectRevert(abi.encodeWithSelector(AgentVault.BudgetExceeded.selector, address(usdc), 2e6, 1.5e6));
        _exec(_one(_transfer(treasury, 1e6)));
    }

    function test_RevertWhen_NativeBudgetExceeded() public {
        _setLimits(NATIVE, 0, 0.015 ether);
        _exec(_one(_native(treasury, 0.01 ether)));
        vm.expectRevert(abi.encodeWithSelector(AgentVault.BudgetExceeded.selector, NATIVE, 0.02 ether, 0.015 ether));
        _exec(_one(_native(treasury, 0.01 ether)));
    }

    function test_SetLimitsRestartsTheBudgetCount() public {
        _execWithVerdict(_one(_transfer(treasury, 8e6)), 0);
        assertEq(vault.spentSinceReset(address(usdc)), 8e6);

        vm.expectEmit(true, false, false, true, address(vault));
        emit LimitsSet(address(usdc), 2e6, 10e6);
        vm.expectEmit(true, false, false, false, address(vault));
        emit BudgetReset(address(usdc));
        _setLimits(address(usdc), 2e6, 10e6);

        assertEq(vault.spentSinceReset(address(usdc)), 0);
        assertEq(vault.remainingBudget(address(usdc)), 10e6);
    }

    function test_BudgetDoesNotLimitTheOwner() public {
        _setLimits(address(usdc), 1, 1);
        vm.prank(owner);
        vault.withdraw(address(usdc), owner, VAULT_USDC);
        assertEq(usdc.balanceOf(owner), VAULT_USDC);

        usdc.mint(address(vault), 5e6);
        vm.prank(owner);
        vault.ownerExecute(_one(_transfer(owner, 5e6)));
        assertEq(vault.spentSinceReset(address(usdc)), 0, "owner path is not counted");
    }

    function test_GetLimitsListsTrackedTokensThenNative() public {
        _setLimits(address(usdc), 5e6, 30e6);
        _setLimits(NATIVE, 0.02 ether, 0.5 ether);
        _execWithVerdict(_one(_transfer(treasury, 4e6)), 0);

        AgentVault.LimitsView[] memory views = vault.getLimits();
        assertEq(views.length, 2);
        assertEq(views[0].token, address(usdc));
        assertEq(views[0].maxPerTx, 5e6);
        assertEq(views[0].budget, 30e6);
        assertEq(views[0].spentSinceReset, 4e6);
        assertEq(views[1].token, NATIVE);
        assertEq(views[1].maxPerTx, 0.02 ether);
        assertEq(views[1].budget, 0.5 ether);
        assertEq(views[1].spentSinceReset, 0);
    }

    // ======================================================== access control

    function test_RevertWhen_NonOwnerSetsLimits() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vm.prank(agent);
        vault.setLimits(address(usdc), 0, 0);
    }

    function test_RevertWhen_NonOwnerResetsBudget() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vm.prank(agent);
        vault.resetBudget(address(usdc));
    }

    function test_RevertWhen_LimitsOnTheVaultItself() public {
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, address(vault)));
        vm.prank(owner);
        vault.setLimits(address(vault), 1, 1);
    }

    // ================================================================ fuzz

    /// A batch succeeds exactly when it fits the daily cap, maxPerTx and the budget left.
    function testFuzz_TransferAcceptedIffWithinEveryLimit(uint256 maxPerTx, uint256 budget, uint256 a, uint256 b)
        public
    {
        maxPerTx = bound(maxPerTx, 0, 25e6);
        budget = bound(budget, 0, 40e6);
        a = bound(a, 1, 25e6);
        b = bound(b, 1, 25e6);
        _setLimits(address(usdc), maxPerTx, budget);

        uint256 spentBudget;
        uint256 spentDay;
        uint256[2] memory amounts = [a, b];
        for (uint256 i; i < 2; ++i) {
            uint256 x = amounts[i];
            bool ok = spentDay + x <= USDC_CAP && (maxPerTx == 0 || x <= maxPerTx)
                && (budget == 0 || spentBudget + x <= budget);
            AgentVault.Call[] memory calls = _one(_transfer(treasury, x));
            AgentVault.Verdict memory v = _verdictFor(calls, 0);
            bytes memory sig = _signWith(GUARDIAN_PK, v);
            vm.prank(agent);
            try vault.executeBatch(calls, v, sig) {
                assertTrue(ok, "accepted outside the limits");
                spentBudget += x;
                spentDay += x;
            } catch {
                assertFalse(ok, "rejected within the limits");
            }
        }
        assertEq(vault.spentSinceReset(address(usdc)), spentBudget);
        assertEq(usdc.balanceOf(treasury), spentBudget);
    }

    // ===================================================== constructor config

    function _config() internal view returns (AgentVault.Config memory c) {
        c.maxAgentRisk = 1;
        c.tokens = new AgentVault.TokenConfig[](1);
        c.tokens[0] = AgentVault.TokenConfig({
            token: address(usdc), dailyCap: 20e6, maxApproval: 10e6, verdictThreshold: 1e6, maxPerTx: 5e6, budget: 50e6
        });
        c.nativeDailyCap = 0.1 ether;
        c.nativeVerdictThreshold = 0.01 ether;
        c.nativeMaxPerTx = 0.05 ether;
        c.nativeBudget = 1 ether;
        c.targets = new AgentVault.TargetConfig[](1);
        c.targets[0].target = address(target);
        c.targets[0].selectors = new bytes4[](2);
        c.targets[0].selectors[0] = MockTarget.pull.selector;
        c.targets[0].selectors[1] = MockTarget.ping.selector;
        c.recipients = new address[](2);
        c.recipients[0] = treasury;
        c.recipients[1] = address(target);
    }

    function test_ConstructorAppliesConfig() public {
        AgentVault v = new AgentVault(owner, agent, guardian, _config());
        assertEq(v.owner(), owner);
        assertEq(v.agent(), agent);
        assertEq(v.guardian(), guardian);
        assertEq(v.maxAgentRisk(), 1);
        (bool tracked, uint256 cap, uint256 maxApproval, uint256 threshold) = v.tokenPolicy(address(usdc));
        assertTrue(tracked);
        assertEq(cap, 20e6);
        assertEq(maxApproval, 10e6);
        assertEq(threshold, 1e6);
        (uint256 maxPerTx, uint256 budget) = v.limits(address(usdc));
        assertEq(maxPerTx, 5e6);
        assertEq(budget, 50e6);
        (maxPerTx, budget) = v.limits(NATIVE);
        assertEq(maxPerTx, 0.05 ether);
        assertEq(budget, 1 ether);
        assertEq(v.nativeDailyCap(), 0.1 ether);
        assertEq(v.nativeVerdictThreshold(), 0.01 ether);
        assertTrue(v.allowedTarget(address(target)));
        assertTrue(v.allowedSelector(address(target), MockTarget.pull.selector));
        assertTrue(v.allowedSelector(address(target), MockTarget.ping.selector));
        assertFalse(v.allowedSelector(address(target), MockTarget.refund.selector));
        assertTrue(v.allowedRecipient(treasury));
        assertFalse(v.allowedRecipient(attacker));
        assertEq(v.trackedTokenCount(), 1);
    }

    function test_ConfiguredVaultEnforcesItsLimits() public {
        vault = new AgentVault(owner, agent, guardian, _config());
        usdc.mint(address(vault), 30e6);
        _execWithVerdictExpectRevert(
            _one(_transfer(treasury, 6e6)),
            0,
            abi.encodeWithSelector(AgentVault.TxCapExceeded.selector, address(usdc), 6e6, 5e6)
        );
        _execWithVerdict(_one(_transfer(treasury, 5e6)), 0);
        assertEq(usdc.balanceOf(treasury), 5e6);
    }

    function test_RevertWhen_ConfigRiskAboveMax() public {
        AgentVault.Config memory c = _config();
        c.maxAgentRisk = 3;
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RiskTooHigh.selector, 3));
        new AgentVault(owner, agent, guardian, c);
    }

    function test_RevertWhen_ConfigTracksNative() public {
        AgentVault.Config memory c = _config();
        c.tokens[0].token = NATIVE;
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TargetNotAllowed.selector, NATIVE));
        new AgentVault(owner, agent, guardian, c);
    }

    function test_RevertWhen_ConfigTracksTooManyTokens() public {
        AgentVault.Config memory c = _config();
        c.tokens = new AgentVault.TokenConfig[](9);
        for (uint256 i; i < 9; ++i) {
            c.tokens[i].token = address(uint160(0x1000 + i));
        }
        vm.expectRevert(AgentVault.TooManyTrackedTokens.selector);
        new AgentVault(owner, agent, guardian, c);
    }
}
