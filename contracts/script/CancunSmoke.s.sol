// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CancunSmoke} from "../src/smoke/CancunSmoke.sol";

/// Fuji smoke test for the Cancun opcodes (SPEC §16). Each entry point sends exactly one transaction
/// from DEPLOYER_PK, so every transaction can be approved on its own:
///   forge script script/CancunSmoke.s.sol --sig "deploy()"                   --rpc-url <fuji> --broadcast
///   forge script script/CancunSmoke.s.sol --sig "checkTransient(address)" <a> --rpc-url <fuji> --broadcast
///   forge script script/CancunSmoke.s.sol --sig "checkMcopy(address)" <a>     --rpc-url <fuji> --broadcast
contract CancunSmokeScript is Script {
    uint256 internal constant TRANSIENT_VALUE = 402;
    bytes internal constant MCOPY_PAYLOAD = "guardian402 cancun smoke: mcopy across more than one 32-byte word";

    function deploy() external returns (CancunSmoke smoke) {
        vm.startBroadcast(vm.envUint("DEPLOYER_PK"));
        smoke = new CancunSmoke();
        vm.stopBroadcast();
        console2.log("CancunSmoke deployed at", address(smoke));
    }

    function checkTransient(CancunSmoke smoke) external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PK"));
        uint256 loaded = smoke.checkTransient(TRANSIENT_VALUE);
        vm.stopBroadcast();
        console2.log("tstore/tload round trip returned", loaded);
    }

    function checkMcopy(CancunSmoke smoke) external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PK"));
        bytes32 hash = smoke.checkMcopy(MCOPY_PAYLOAD);
        vm.stopBroadcast();
        console2.log("mcopy copy hash");
        console2.logBytes32(hash);
    }
}
