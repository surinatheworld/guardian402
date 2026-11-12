// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// The factory creates a vault owned by the caller, with the caller's policy and the factory's Guardian, and
/// keeps no rights over it: only the owner can withdraw or change the policy.
contract VaultFactoryTest is Test {
    event VaultCreated(address indexed owner, address indexed vault, address indexed agent, address guardian);

    VaultFactory internal factory;
    MockUSDC internal usdc;
    address internal guardian = makeAddr("guardian");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal agent = makeAddr("agent");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        factory = new VaultFactory();
        usdc = new MockUSDC();
    }

    function _config() internal view returns (AgentVault.Config memory c) {
        c.tokens = new AgentVault.TokenConfig[](1);
        c.tokens[0] = AgentVault.TokenConfig({
            token: address(usdc), dailyCap: 20e6, maxApproval: 0, verdictThreshold: 1e6, maxPerTx: 5e6, budget: 50e6
        });
        c.recipients = new address[](1);
        c.recipients[0] = treasury;
    }

    function test_RevertWhen_ZeroGuardian() public {
        vm.expectRevert(VaultFactory.ZeroGuardian.selector);
        vm.prank(alice);
        factory.createVault(agent, address(0), _config());
    }

    function test_EachVaultHasTheGuardianItWasCreatedWith() public {
        address other = makeAddr("other-guardian");
        vm.prank(alice);
        AgentVault a = factory.createVault(agent, guardian, _config());
        vm.prank(bob);
        AgentVault b = factory.createVault(agent, other, _config());
        assertEq(a.guardian(), guardian);
        assertEq(b.guardian(), other);
    }

    function test_CreateVault_CallerOwnsIt() public {
        vm.expectEmit(true, false, true, false, address(factory));
        emit VaultCreated(alice, address(0), agent, guardian);
        vm.prank(alice);
        AgentVault vault = factory.createVault(agent, guardian, _config());

        assertEq(vault.owner(), alice);
        assertEq(vault.pendingOwner(), address(0));
        assertEq(vault.agent(), agent);
        assertEq(vault.guardian(), guardian);
        assertTrue(vault.allowedRecipient(treasury));
        (uint256 maxPerTx, uint256 budget) = vault.limits(address(usdc));
        assertEq(maxPerTx, 5e6);
        assertEq(budget, 50e6);

        address[] memory mine = factory.vaultsOf(alice);
        assertEq(mine.length, 1);
        assertEq(mine[0], address(vault));
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), address(vault));
    }

    function test_CreateVault_ZeroAgentAllowed() public {
        vm.prank(alice);
        AgentVault vault = factory.createVault(address(0), guardian, _config());
        assertEq(vault.agent(), address(0));
    }

    function test_VaultsAreTrackedPerOwner() public {
        vm.startPrank(alice);
        factory.createVault(agent, guardian, _config());
        factory.createVault(agent, guardian, _config());
        vm.stopPrank();
        vm.prank(bob);
        factory.createVault(agent, guardian, _config());
        assertEq(factory.vaultsOf(alice).length, 2);
        assertEq(factory.vaultsOf(bob).length, 1);
        assertEq(factory.vaultCount(), 3);
    }

    /// Money path: the owner deposits with a plain transfer and can always withdraw; nobody else can.
    function test_DepositThenOnlyOwnerWithdraws() public {
        vm.prank(alice);
        AgentVault vault = factory.createVault(agent, guardian, _config());
        usdc.mint(alice, 10e6);
        vm.prank(alice);
        IERC20(address(usdc)).transfer(address(vault), 10e6);
        assertEq(usdc.balanceOf(address(vault)), 10e6);

        vm.prank(address(factory));
        vm.expectRevert();
        vault.withdraw(address(usdc), address(factory), 10e6);
        vm.prank(bob);
        vm.expectRevert();
        vault.withdraw(address(usdc), bob, 10e6);

        vm.prank(alice);
        vault.withdraw(address(usdc), alice, 10e6);
        assertEq(usdc.balanceOf(alice), 10e6);
    }

    function test_FactoryCannotChangeTheVault() public {
        vm.prank(alice);
        AgentVault vault = factory.createVault(agent, guardian, _config());
        vm.startPrank(address(factory));
        vm.expectRevert();
        vault.setAgent(bob);
        vm.expectRevert();
        vault.pause();
        vm.stopPrank();
    }

    function test_NativeDepositThroughReceive() public {
        vm.prank(alice);
        AgentVault vault = factory.createVault(agent, guardian, _config());
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, 0.5 ether);
    }
}
