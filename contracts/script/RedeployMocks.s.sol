// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";

/// Replaces the DEMO mWAVAX and MockRouter of an existing deployment (P2 fix, SPEC §16), in two steps:
///   deploy()                    deployer: new mWAVAX + new MockRouter (same USDC and oracle), 1,000 mWAVAX
///                               inventory, and rewrites deployments/<NETWORK>.json
///   swapAllowlist(oldRouter)    owner: removes the old router from the vault allowlist, allows the new one
/// Run through `pnpm redeploy-mocks:fuji` and `pnpm swap-router:fuji <oldRouter>`.
contract RedeployMocks is Script {
    using stdJson for string;

    uint256 internal constant ROUTER_INVENTORY = 1_000e18;

    function deploy() external {
        require(block.chainid == 43113, "not Avalanche Fuji (43113)");
        string memory network = vm.envString("NETWORK");
        string memory path = string.concat("./deployments/", network, ".json");
        string memory json = vm.readFile(path);
        address usdc = json.readAddress(".usdc");
        MockOracle oracle = MockOracle(json.readAddress(".oracle"));

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        vm.startBroadcast(deployerPk);
        MockERC20 wavax = new MockERC20("Mock Wrapped AVAX", "mWAVAX", 18, deployer);
        MockRouter router = new MockRouter(IERC20(usdc), IERC20(address(wavax)), oracle, deployer);
        wavax.mint(address(router), ROUTER_INVENTORY);
        vm.stopBroadcast();

        string memory key = "addresses";
        vm.serializeString(key, "network", network);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", json.readUint(".startBlock"));
        vm.serializeAddress(key, "deployer", json.readAddress(".deployer"));
        vm.serializeAddress(key, "owner", json.readAddress(".owner"));
        vm.serializeAddress(key, "usdc", usdc);
        vm.serializeAddress(key, "oracle", address(oracle));
        vm.serializeAddress(key, "vault", json.readAddress(".vault"));
        if (vm.keyExistsJson(json, ".cancunSmoke")) {
            vm.serializeAddress(key, "cancunSmoke", json.readAddress(".cancunSmoke"));
        }
        vm.serializeAddress(key, "mWAVAX", address(wavax));
        string memory out = vm.serializeAddress(key, "router", address(router));
        vm.writeJson(out, path);

        console2.log("old mWAVAX ", json.readAddress(".mWAVAX"));
        console2.log("old router ", json.readAddress(".router"));
        console2.log("new mWAVAX ", address(wavax));
        console2.log("new router ", address(router));
    }

    function swapAllowlist(address oldRouter) external {
        require(block.chainid == 43113, "not Avalanche Fuji (43113)");
        string memory json = vm.readFile(string.concat("./deployments/", vm.envString("NETWORK"), ".json"));
        AgentVault vault = AgentVault(payable(json.readAddress(".vault")));
        address newRouter = json.readAddress(".router");
        require(oldRouter != newRouter, "deployments json still names the old router");
        uint256 ownerPk = vm.envUint("OWNER_PK");
        require(vault.owner() == vm.addr(ownerPk), "OWNER_PK is not the vault owner");
        bytes4 swap = MockRouter.swapExactIn.selector;

        vm.startBroadcast(ownerPk);
        if (vault.allowedSelector(oldRouter, swap)) vault.setAllowedSelector(oldRouter, swap, false);
        if (vault.allowedTarget(oldRouter)) vault.setAllowedTarget(oldRouter, false);
        if (vault.allowedRecipient(oldRouter)) vault.setAllowedRecipient(oldRouter, false);
        if (!vault.allowedTarget(newRouter)) vault.setAllowedTarget(newRouter, true);
        if (!vault.allowedSelector(newRouter, swap)) vault.setAllowedSelector(newRouter, swap, true);
        if (!vault.allowedRecipient(newRouter)) vault.setAllowedRecipient(newRouter, true);
        vm.stopBroadcast();

        console2.log("removed    ", oldRouter);
        console2.log("allowed    ", newRouter);
    }
}
