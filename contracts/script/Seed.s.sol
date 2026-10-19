// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";

/// Seeds the vault and the DEMO mocks with the values of SPEC §4.8. Safe to run again: it only sends the
/// transactions whose state is not already right. Run through `pnpm seed:local|fuji`.
contract Seed is Script {
    using stdJson for string;

    // SPEC §4.8
    uint256 internal constant USDC_DAILY_CAP = 20e6;
    uint256 internal constant USDC_MAX_APPROVAL = 10e6;
    uint256 internal constant USDC_VERDICT_THRESHOLD = 1e6;
    uint256 internal constant NATIVE_DAILY_CAP = 0.1 ether;
    uint256 internal constant NATIVE_VERDICT_THRESHOLD = 0.01 ether;
    uint256 internal constant VAULT_USDC = 50e6;
    // Demo values chosen in P2 (SPEC §16)
    uint256 internal constant ORACLE_PRICE = 25e6; // 25 USDC per mWAVAX
    uint256 internal constant ROUTER_INVENTORY = 1_000e18; // mWAVAX
    uint256 internal constant OWNER_GAS = 0.05 ether;
    uint256 internal constant AGENT_GAS = 0.1 ether;

    struct Deployment {
        AgentVault vault;
        IERC20 usdc;
        MockERC20 wavax;
        MockOracle oracle;
        address router;
    }

    function run() external {
        require(block.chainid == 43113, "not Avalanche Fuji (43113)");
        Deployment memory d = _load(vm.envString("NETWORK"));

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        uint256 ownerPk = vm.envUint("OWNER_PK");
        address owner = vm.addr(ownerPk);
        address agent = vm.addr(vm.envUint("AGENT_PK"));
        address guardian = vm.addr(vm.envUint("GUARDIAN_SIGNER_PK"));
        address treasury = vm.envOr("TREASURY", vm.addr(deployerPk));
        require(d.vault.owner() == owner, "OWNER_PK is not the vault owner");

        // Deployer: gas for owner and agent, oracle price, router inventory.
        vm.startBroadcast(deployerPk);
        if (owner.balance < OWNER_GAS) payable(owner).transfer(OWNER_GAS - owner.balance);
        if (agent.balance < AGENT_GAS) payable(agent).transfer(AGENT_GAS - agent.balance);
        if (d.oracle.price() != ORACLE_PRICE) d.oracle.setPrice(ORACLE_PRICE);
        uint256 inventory = d.wavax.balanceOf(d.router);
        if (inventory < ROUTER_INVENTORY) d.wavax.mint(d.router, ROUTER_INVENTORY - inventory);
        vm.stopBroadcast();

        // Owner: vault policy, roles and funding.
        vm.startBroadcast(ownerPk);
        _seedPolicy(d, treasury);
        if (d.vault.agent() != agent) d.vault.setAgent(agent);
        if (d.vault.guardian() != guardian) d.vault.setGuardian(guardian);
        if (d.vault.maxAgentRisk() != 0) d.vault.setMaxAgentRisk(0);
        _fundVault(d, owner);
        vm.stopBroadcast();

        console2.log("vault      ", address(d.vault));
        console2.log("agent      ", agent);
        console2.log("guardian   ", guardian);
        console2.log("treasury   ", treasury);
        console2.log("vault USDC ", d.usdc.balanceOf(address(d.vault)));
    }

    function _load(string memory network) internal view returns (Deployment memory d) {
        string memory json = vm.readFile(string.concat("./deployments/", network, ".json"));
        d.vault = AgentVault(payable(json.readAddress(".vault")));
        d.usdc = IERC20(json.readAddress(".usdc"));
        d.wavax = MockERC20(json.readAddress(".mWAVAX"));
        d.oracle = MockOracle(json.readAddress(".oracle"));
        d.router = json.readAddress(".router");
    }

    function _seedPolicy(Deployment memory d, address treasury) internal {
        AgentVault vault = d.vault;
        (bool tracked, uint256 cap, uint256 maxApproval, uint256 threshold) = vault.tokenPolicy(address(d.usdc));
        if (
            !tracked || cap != USDC_DAILY_CAP || maxApproval != USDC_MAX_APPROVAL || threshold != USDC_VERDICT_THRESHOLD
        ) {
            vault.setTokenPolicy(address(d.usdc), true, USDC_DAILY_CAP, USDC_MAX_APPROVAL, USDC_VERDICT_THRESHOLD);
        }
        if (vault.nativeDailyCap() != NATIVE_DAILY_CAP || vault.nativeVerdictThreshold() != NATIVE_VERDICT_THRESHOLD) {
            vault.setNativePolicy(NATIVE_DAILY_CAP, NATIVE_VERDICT_THRESHOLD);
        }
        if (!vault.allowedTarget(d.router)) vault.setAllowedTarget(d.router, true);
        if (!vault.allowedSelector(d.router, MockRouter.swapExactIn.selector)) {
            vault.setAllowedSelector(d.router, MockRouter.swapExactIn.selector, true);
        }
        if (!vault.allowedRecipient(d.router)) vault.setAllowedRecipient(d.router, true);
        if (!vault.allowedRecipient(treasury)) vault.setAllowedRecipient(treasury, true);
    }

    function _fundVault(Deployment memory d, address owner) internal {
        uint256 vaultUsdc = d.usdc.balanceOf(address(d.vault));
        if (vaultUsdc >= VAULT_USDC) return;
        uint256 need = VAULT_USDC - vaultUsdc;
        uint256 have = d.usdc.balanceOf(owner);
        if (have >= need) {
            require(d.usdc.transfer(address(d.vault), need), "USDC transfer failed");
        } else {
            console2.log("WARNING: owner holds too little USDC to fund the vault. Need / have (6 decimals):");
            console2.log(need, have);
        }
    }
}
