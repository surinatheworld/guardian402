// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CancunSmoke} from "../src/smoke/CancunSmoke.sol";

contract CancunSmokeTest is Test {
    CancunSmoke internal smoke;

    function setUp() public {
        smoke = new CancunSmoke();
    }

    function test_CheckTransient_RoundTripsAndStores() public {
        vm.expectEmit(address(smoke));
        emit CancunSmoke.TransientChecked(42);
        assertEq(smoke.checkTransient(42), 42);
        assertEq(smoke.lastTransientValue(), 42);
    }

    function test_CheckMcopy_CopiesAndStoresHash() public {
        bytes memory data = "guardian402 cancun smoke: mcopy across more than one 32-byte word";
        vm.expectEmit(address(smoke));
        emit CancunSmoke.McopyChecked(keccak256(data), data.length);
        assertEq(smoke.checkMcopy(data), keccak256(data));
        assertEq(smoke.lastCopyHash(), keccak256(data));
        assertEq(smoke.lastCopyLength(), data.length);
    }

    function test_CheckMcopy_EmptyInput() public {
        assertEq(smoke.checkMcopy(""), keccak256(""));
        assertEq(smoke.lastCopyLength(), 0);
    }

    function testFuzz_CheckTransient(uint256 value) public {
        assertEq(smoke.checkTransient(value), value);
    }

    function testFuzz_CheckMcopy(bytes calldata data) public {
        assertEq(smoke.checkMcopy(data), keccak256(data));
    }
}
