// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// Deploys the VaultFactory (SPEC §4.10) with the Guardian signer of GUARDIAN_SIGNER_PK as the guardian of every
/// vault it creates. Writes the address and start block to contracts/deployments/<NETWORK>-factory.json; the
/// wrapper (`pnpm deploy-factory:fuji`) merges it into the shared addresses.
contract DeployFactory is Script {
    function run() external {
        require(block.chainid == 43113, "not Avalanche Fuji (43113)");
        string memory network = vm.envString("NETWORK");
        address guardian = vm.addr(vm.envUint("GUARDIAN_SIGNER_PK"));
        uint256 startBlock = vm.getBlockNumber();

        vm.startBroadcast(vm.envUint("DEPLOYER_PK"));
        VaultFactory factory = new VaultFactory(guardian);
        vm.stopBroadcast();

        string memory key = "factory";
        vm.serializeUint(key, "factoryStartBlock", startBlock);
        string memory out = vm.serializeAddress(key, "factory", address(factory));
        string memory path = string.concat("./deployments/", network, "-factory.json");
        vm.writeJson(out, path);

        console2.log("VaultFactory", address(factory));
        console2.log("guardian    ", guardian);
        console2.log("written to  ", path);
    }
}
