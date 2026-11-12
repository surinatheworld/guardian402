// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";

/// Replaces AgentVault with the current code and keeps the mocks (P11 finding F1, docs/THREAT_MODEL.md).
/// If OWNER_PK still owns the old vault, it first withdraws the old vault's USDC and AVAX to the owner, so
/// `pnpm seed:<network>` can fund the new one. Writes the new address and start block to
/// contracts/deployments/<NETWORK>-vault.json; the wrapper merges it into the shared addresses.
/// Run through `pnpm redeploy-vault:fuji`, then `pnpm seed:fuji` and `pnpm handoff:fuji`.
contract RedeployVault is Script {
    using stdJson for string;

    function run() external {
        require(block.chainid == 43113, "not Avalanche Fuji (43113)");
        string memory network = vm.envString("NETWORK");
        string memory json = vm.readFile(string.concat("./deployments/", network, ".json"));
        AgentVault old = AgentVault(payable(json.readAddress(".vault")));
        IERC20 usdc = IERC20(json.readAddress(".usdc"));

        uint256 ownerPk = vm.envUint("OWNER_PK");
        address owner = vm.addr(ownerPk);
        uint256 startBlock = vm.getBlockNumber();

        if (address(old).code.length > 0 && old.owner() == owner) {
            uint256 oldUsdc = usdc.balanceOf(address(old));
            uint256 oldNative = address(old).balance;
            vm.startBroadcast(ownerPk);
            if (oldUsdc > 0) old.withdraw(address(usdc), owner, oldUsdc);
            if (oldNative > 0) old.withdrawNative(payable(owner), oldNative);
            if (!old.paused()) old.pause();
            vm.stopBroadcast();
            console2.log("old vault emptied and paused", address(old));
            console2.log("USDC withdrawn to owner", oldUsdc);
        } else {
            console2.log("OWNER_PK does not own the old vault: nothing withdrawn", address(old));
        }

        vm.startBroadcast(vm.envUint("DEPLOYER_PK"));
        AgentVault.Config memory emptyConfig;
        AgentVault vault = new AgentVault(owner, address(0), address(0), emptyConfig);
        vm.stopBroadcast();

        string memory key = "vault";
        vm.serializeAddress(key, "previousVault", address(old));
        vm.serializeUint(key, "startBlock", startBlock);
        string memory out = vm.serializeAddress(key, "vault", address(vault));
        string memory path = string.concat("./deployments/", network, "-vault.json");
        vm.writeJson(out, path);

        console2.log("AgentVault ", address(vault));
        console2.log("written to ", path);
    }
}
