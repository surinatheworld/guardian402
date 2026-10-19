// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AgentVault} from "../src/AgentVault.sol";

/// Starts the Ownable2Step transfer of AgentVault to the team lead's wallet (SPEC §16). The new owner then
/// calls acceptOwnership() from that wallet. Run through `pnpm handoff:fuji`.
contract HandOff is Script {
    using stdJson for string;

    address internal constant TEAM_LEAD = 0x54A2276F134d3Cfaa7572BC326092fABa6352888;

    function run() external {
        require(block.chainid == 43113, "not Avalanche Fuji (43113)");
        string memory network = vm.envString("NETWORK");
        string memory json = vm.readFile(string.concat("./deployments/", network, ".json"));
        AgentVault vault = AgentVault(payable(json.readAddress(".vault")));

        uint256 ownerPk = vm.envUint("OWNER_PK");
        require(vault.owner() == vm.addr(ownerPk), "OWNER_PK is not the vault owner");
        if (vault.pendingOwner() != TEAM_LEAD) {
            vm.startBroadcast(ownerPk);
            vault.transferOwnership(TEAM_LEAD);
            vm.stopBroadcast();
        }
        console2.log("owner        ", vault.owner());
        console2.log("pendingOwner ", vault.pendingOwner());
    }
}
