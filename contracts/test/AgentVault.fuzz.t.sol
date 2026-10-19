// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AgentVault} from "../src/AgentVault.sol";
import {AgentVaultBase} from "./utils/AgentVaultBase.sol";

contract AgentVaultFuzzTest is AgentVaultBase {
    // ---------------------------------------------------- amounts vs policy

    function testFuzz_TransferAgainstThresholdAndCap(uint256 amount) public {
        amount = bound(amount, 1, VAULT_USDC);
        AgentVault.Call[] memory calls = _one(_transfer(treasury, amount));
        if (amount > USDC_CAP) {
            _execWithVerdictExpectRevert(
                calls, 0, abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(usdc), amount, USDC_CAP)
            );
            return;
        }
        if (amount > USDC_THRESHOLD) {
            vm.expectRevert(AgentVault.VerdictRequired.selector);
            _exec(calls);
            _execWithVerdict(calls, 0);
        } else {
            _exec(calls);
        }
        assertEq(usdc.balanceOf(treasury), amount);
        assertEq(vault.spent(address(usdc), _today()), amount);
    }

    function testFuzz_CumulativeDailyCap(uint256 a, uint256 b) public {
        a = bound(a, 1, USDC_CAP);
        b = bound(b, 1, USDC_CAP);
        _execWithVerdict(_one(_transfer(treasury, a)), 0);
        AgentVault.Call[] memory second = _one(_transfer(treasury, b));
        if (a + b > USDC_CAP) {
            _execWithVerdictExpectRevert(
                second, 0, abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(usdc), a + b, USDC_CAP)
            );
            assertEq(vault.spent(address(usdc), _today()), a);
        } else {
            _execWithVerdict(second, 0);
            assertEq(vault.spent(address(usdc), _today()), a + b);
        }
        assertLe(vault.spent(address(usdc), _today()), USDC_CAP);
    }

    function testFuzz_CapResetsAfterDayBoundary(uint256 a, uint256 elapsed) public {
        a = bound(a, 1, USDC_CAP);
        elapsed = bound(elapsed, 0, 3 days);
        uint256 dayBefore = _today();
        _execWithVerdict(_one(_transfer(treasury, a)), 0);
        vm.warp(vm.getBlockTimestamp() + elapsed);
        AgentVault.Call[] memory full = _one(_transfer(treasury, USDC_CAP));
        if (_today() == dayBefore && a > 0) {
            _execWithVerdictExpectRevert(
                full,
                0,
                abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(usdc), a + USDC_CAP, USDC_CAP)
            );
        } else {
            _execWithVerdict(full, 0);
            assertEq(vault.spent(address(usdc), _today()), USDC_CAP);
        }
    }

    function testFuzz_NativeAgainstThresholdAndCap(uint256 value) public {
        value = bound(value, 1, VAULT_NATIVE);
        AgentVault.Call[] memory calls = _one(_native(treasury, value));
        if (value > NATIVE_CAP) {
            _execWithVerdictExpectRevert(
                calls, 0, abi.encodeWithSelector(AgentVault.DailyCapExceeded.selector, address(0), value, NATIVE_CAP)
            );
            return;
        }
        if (value > NATIVE_THRESHOLD) {
            vm.expectRevert(AgentVault.VerdictRequired.selector);
            _exec(calls);
            _execWithVerdict(calls, 0);
        } else {
            _exec(calls);
        }
        assertEq(treasury.balance, value);
    }

    function testFuzz_ApprovalAgainstMax(uint256 amount) public {
        amount = bound(amount, 0, 3 * USDC_MAX_APPROVAL);
        AgentVault.Call[] memory calls = _one(_approve(address(target), amount));
        if (amount == 0) {
            _exec(calls);
        } else if (amount > USDC_MAX_APPROVAL) {
            _execWithVerdictExpectRevert(
                calls, 0, abi.encodeWithSelector(AgentVault.ApprovalTooLarge.selector, address(usdc), amount)
            );
            return;
        } else {
            vm.expectRevert(AgentVault.VerdictRequired.selector);
            _exec(calls);
            _execWithVerdict(calls, 0);
        }
        assertEq(usdc.allowance(address(vault), address(target)), amount);
    }

    // ------------------------------------------------ random allowed batches

    function testFuzz_RandomAllowedBatch(uint256 seed, uint256 length) public {
        length = bound(length, 1, 8);
        AgentVault.Call[] memory calls = new AgentVault.Call[](length);
        uint256 usdcOut;
        uint256 nativeOut;
        for (uint256 i; i < length; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 kind = r % 4;
            uint256 amount = (r >> 8) % 2e6 + 1; // at most 8 × 2 USDC = 16 USDC < cap
            uint256 value = (r >> 16) % 0.005 ether + 1; // at most 0.04 AVAX < cap
            if (kind == 0) {
                calls[i] = _transfer(treasury, amount);
                usdcOut += amount;
            } else if (kind == 1) {
                calls[i] = _approve(address(target), amount);
            } else if (kind == 2) {
                calls[i] = _ping(value);
                nativeOut += value;
            } else {
                calls[i] = _native(treasury, value);
                nativeOut += value;
            }
        }
        _execWithVerdict(calls, 0);
        assertEq(usdc.balanceOf(address(vault)), VAULT_USDC - usdcOut);
        assertEq(address(vault).balance, VAULT_NATIVE - nativeOut);
        assertEq(vault.spent(address(usdc), _today()), usdcOut);
        assertEq(vault.spent(address(0), _today()), nativeOut);
        assertEq(vault.verdictNonce(), 1);
    }

    // ------------------------------------------------------- verdict binding

    function testFuzz_TamperedVerdictRejected(uint256 field, bytes32 noise) public {
        vm.assume(noise != bytes32(0));
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        bytes4 expected;
        field = bound(field, 0, 4);
        if (field == 0) {
            v.callsHash ^= noise;
            expected = AgentVault.InvalidVerdict.selector;
        } else if (field == 1) {
            v.nonce = uint256(noise);
            expected = AgentVault.InvalidVerdict.selector;
        } else if (field == 2) {
            v.deadline = uint64(block.timestamp + 61 + (uint256(noise) % 1e9));
            expected = AgentVault.BadSignature.selector;
        } else if (field == 3) {
            v.risk = 1 + uint8(uint256(noise) % 2);
            expected = AgentVault.BadSignature.selector;
        } else {
            v.checkId ^= noise;
            expected = AgentVault.BadSignature.selector;
        }
        vm.expectRevert(expected);
        _execSigned(calls, v, sig);
        assertEq(vault.verdictNonce(), 0);
    }

    function testFuzz_WrongSignerRejected(uint256 pk) public {
        pk = bound(pk, 1, 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140);
        vm.assume(pk != GUARDIAN_PK);
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(pk, v);
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, sig);
    }

    function testFuzz_VerdictForOneAmountDoesNotAuthorizeAnother(uint256 signed, uint256 sent) public {
        signed = bound(signed, 1, USDC_CAP);
        sent = bound(sent, 1, USDC_CAP);
        vm.assume(signed != sent);
        AgentVault.Verdict memory v = _verdictFor(_one(_transfer(treasury, signed)), 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);
        vm.expectRevert(AgentVault.InvalidVerdict.selector);
        _execSigned(_one(_transfer(treasury, sent)), v, sig);
    }

    function testFuzz_OnlyAgentCanExecute(address caller) public {
        vm.assume(caller != agent);
        vm.prank(caller);
        vm.expectRevert(AgentVault.NotAgent.selector);
        vault.executeBatch(_one(_transfer(treasury, 1)), _noVerdict(), "");
    }
}
