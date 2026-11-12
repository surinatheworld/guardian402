// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";

/// Deploys AgentVault (owner = OWNER address; agent and guardian are set by Seed) and the DEMO mocks, and
/// writes contracts/deployments/<NETWORK>.json, which the wrapper copies to packages/shared/src/addresses (SPEC §4.8). Run through `pnpm deploy:local|fuji`.
contract Deploy is Script {
    address internal constant FUJI_USDC = 0x5425890298aed601595a70AB815c96711a31Bc65;
    uint256 internal constant INITIAL_PRICE = 25e6; // 25 USDC per mWAVAX; Seed sets the final value

    function run() external {
        string memory network = vm.envString("NETWORK");
        bytes32 n = keccak256(bytes(network));
        require(n == keccak256("local") || n == keccak256("fuji"), "NETWORK must be local or fuji");
        require(block.chainid == 43113, "not Avalanche Fuji (43113)");

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        address owner = vm.addr(vm.envUint("OWNER_PK"));
        uint256 startBlock = vm.getBlockNumber();

        vm.startBroadcast(deployerPk);
        AgentVault.Config memory emptyConfig;
        AgentVault vault = new AgentVault(owner, address(0), address(0), emptyConfig);
        MockERC20 wavax = new MockERC20("Mock Wrapped AVAX", "mWAVAX", 18, deployer);
        MockOracle oracle = new MockOracle(deployer, INITIAL_PRICE);
        MockRouter router = new MockRouter(IERC20(FUJI_USDC), IERC20(address(wavax)), oracle, deployer);
        vm.stopBroadcast();

        string memory key = "addresses";
        vm.serializeString(key, "network", network);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", startBlock);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "owner", owner);
        vm.serializeAddress(key, "usdc", FUJI_USDC);
        vm.serializeAddress(key, "mWAVAX", address(wavax));
        vm.serializeAddress(key, "oracle", address(oracle));
        vm.serializeAddress(key, "router", address(router));
        string memory json = vm.serializeAddress(key, "vault", address(vault));
        string memory path = string.concat("./deployments/", network, ".json");
        vm.writeJson(json, path);

        console2.log("AgentVault ", address(vault));
        console2.log("mWAVAX     ", address(wavax));
        console2.log("MockOracle ", address(oracle));
        console2.log("MockRouter ", address(router));
        console2.log("written to ", path);
    }
}
