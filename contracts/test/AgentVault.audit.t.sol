// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AgentVault} from "../src/AgentVault.sol";
import {AgentVaultBase} from "./utils/AgentVaultBase.sol";

/// P11 security review (docs/THREAT_MODEL.md, "Findings of the P11 review"). Each test demonstrates one finding
/// and keeps guarding the fix.
contract AgentVaultAuditTest is AgentVaultBase {
    /// F1 (Medium): an approval granted on the agent path outlived its batch. After a verdict-backed
    /// `approve(spender, 10) + pull(2)`, 8 USDC of allowance stayed with the spender, and the agent could then
    /// spend it in batches at or below the verdict threshold with no verdict at all (no approve call needed).
    /// With an allowlisted router whose swap takes an output recipient, those batches could send the output to
    /// any address, up to the daily cap every day. Fix: the vault revokes, at the end of the batch, every
    /// approval the batch granted.
    function test_Audit_F1_ApprovalDoesNotOutliveItsBatch() public {
        _execWithVerdict(_two(_approve(address(target), USDC_MAX_APPROVAL), _pull(2e6)), 0);
        assertEq(usdc.allowance(address(vault), address(target)), 0, "leftover allowance after the batch");
    }

    function test_Audit_F1_NoVerdictPullOnLeftoverAllowance() public {
        _execWithVerdict(_two(_approve(address(target), USDC_MAX_APPROVAL), _pull(2e6)), 0);
        // At the verdict threshold: no verdict needed. Before the fix this pulled 1 USDC on the old allowance.
        vm.expectRevert();
        _exec(_one(_pull(USDC_THRESHOLD)));
        assertEq(usdc.balanceOf(address(target)), 2e6);
    }

    /// F1, the same batch: a revocation is still allowed and the approval still works inside its own batch.
    function test_Audit_F1_ApprovalStillUsableInsideItsBatch() public {
        _execWithVerdict(_two(_approve(address(target), 3e6), _pull(3e6)), 0);
        assertEq(usdc.balanceOf(address(target)), 3e6);
        assertEq(usdc.allowance(address(vault), address(target)), 0);
    }

    /// F2 (Low, accepted): the daily cap is per UTC day, so up to twice the cap can leave within minutes around
    /// 00:00 UTC. Kept by design (simple, predictable); the Guardian's DRAIN_PATTERN and the verdict threshold
    /// still apply to each batch. This test documents the behaviour.
    function test_Audit_F2_CapResetsAtUtcMidnight() public {
        uint256 midnight = (block.timestamp / 1 days + 1) * 1 days;
        vm.warp(midnight - 60);
        _execWithVerdict(_one(_transfer(treasury, USDC_CAP)), 0);
        vm.warp(midnight + 60);
        _execWithVerdict(_one(_transfer(treasury, USDC_CAP)), 0);
        assertEq(usdc.balanceOf(treasury), 2 * USDC_CAP);
    }

    /// F1 does not touch approvals the owner grants on the owner path.
    function test_Audit_F1_OwnerApprovalsAreKept() public {
        AgentVault.Call[] memory calls = _one(_approve(address(target), 7e6));
        vm.prank(owner);
        vault.ownerExecute(calls);
        assertEq(usdc.allowance(address(vault), address(target)), 7e6);
    }
}
