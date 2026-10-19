// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {AgentVaultBase} from "./utils/AgentVaultBase.sol";

contract MocksTest is AgentVaultBase {
    uint256 internal constant PRICE = 25e6; // 25 USDC per mWAVAX

    MockERC20 internal wavax;
    MockOracle internal oracle;
    MockRouter internal router;
    address internal mockOwner = makeAddr("mockOwner");

    function setUp() public override {
        super.setUp();
        wavax = new MockERC20("Mock Wrapped AVAX", "mWAVAX", 18, mockOwner);
        oracle = new MockOracle(mockOwner, PRICE);
        router = new MockRouter(IERC20(address(usdc)), IERC20(address(wavax)), oracle, mockOwner);
        vm.prank(mockOwner);
        wavax.mint(address(router), 1_000e18);

        vm.startPrank(owner);
        vault.setAllowedTarget(address(router), true);
        vault.setAllowedSelector(address(router), MockRouter.swapExactIn.selector, true);
        vault.setAllowedRecipient(address(router), true);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ MockERC20

    function test_MockERC20_Metadata() public view {
        assertEq(wavax.name(), "Mock Wrapped AVAX");
        assertEq(wavax.symbol(), "mWAVAX");
        assertEq(wavax.decimals(), 18);
        assertEq(wavax.owner(), mockOwner);
    }

    function test_MockERC20_OnlyOwnerMints() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        wavax.mint(attacker, 1);
        vm.prank(mockOwner);
        wavax.mint(treasury, 5e18);
        assertEq(wavax.balanceOf(treasury), 5e18);
    }

    // ----------------------------------------------------------- MockOracle

    function test_MockOracle_SetPrice() public {
        vm.expectEmit(address(oracle));
        emit MockOracle.PriceSet(30e6);
        vm.prank(mockOwner);
        oracle.setPrice(30e6);
        assertEq(oracle.price(), 30e6);
        assertEq(oracle.PRICE_DECIMALS(), 6);
    }

    function test_MockOracle_RevertWhen_ZeroOrNotOwner() public {
        vm.prank(mockOwner);
        vm.expectRevert(MockOracle.ZeroPrice.selector);
        oracle.setPrice(0);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        oracle.setPrice(1);
        vm.expectRevert(MockOracle.ZeroPrice.selector);
        new MockOracle(mockOwner, 0);
    }

    // ----------------------------------------------------------- MockRouter

    function test_MockRouter_QuotePools() public view {
        // 2 USDC at 25 USDC/mWAVAX = 0.08 mWAVAX before skew.
        assertEq(router.quote(address(usdc), address(wavax), 2e6, 0), 0.08e18 * 9_970 / 10_000);
        assertEq(router.quote(address(usdc), address(wavax), 2e6, 1), 0.08e18 * 7_000 / 10_000);
        assertEq(router.skewBps(0), 30);
        assertEq(router.skewBps(1), 3_000);
    }

    function test_MockRouter_RevertWhen_UnknownPoolOrPair() public {
        vm.expectRevert(abi.encodeWithSelector(MockRouter.UnknownPool.selector, uint8(2)));
        router.quote(address(usdc), address(wavax), 1e6, 2);
        vm.expectRevert(abi.encodeWithSelector(MockRouter.UnsupportedPair.selector, address(wavax), address(usdc)));
        router.quote(address(wavax), address(usdc), 1e6, 0);
        vm.expectRevert(abi.encodeWithSelector(MockRouter.UnsupportedPair.selector, address(usdc), address(usdc)));
        router.quote(address(usdc), address(usdc), 1e6, 0);
    }

    function test_MockRouter_Swap() public {
        usdc.mint(treasury, 2e6);
        vm.startPrank(treasury);
        usdc.approve(address(router), 2e6);
        uint256 expected = router.quote(address(usdc), address(wavax), 2e6, 0);
        vm.expectEmit(address(router));
        emit MockRouter.Swapped(treasury, attacker, 0, 2e6, expected);
        uint256 out = router.swapExactIn(address(usdc), address(wavax), 2e6, expected, 0, attacker);
        vm.stopPrank();
        assertEq(out, expected);
        assertEq(wavax.balanceOf(attacker), expected);
        assertEq(usdc.balanceOf(address(router)), 2e6);
    }

    function test_MockRouter_RevertWhen_MinOutNotMet() public {
        uint256 expected = router.quote(address(usdc), address(wavax), 2e6, 1);
        vm.expectRevert(abi.encodeWithSelector(MockRouter.InsufficientOutput.selector, expected, expected + 1));
        router.swapExactIn(address(usdc), address(wavax), 2e6, expected + 1, 1, treasury);
    }

    function test_MockRouter_RevertWhen_InventoryTooSmall() public {
        uint256 amountIn = 1_000_000e6; // 40,000 mWAVAX fair value, inventory is 1,000
        uint256 expected = router.quote(address(usdc), address(wavax), amountIn, 0);
        vm.expectRevert(abi.encodeWithSelector(MockRouter.InsufficientInventory.selector, expected, 1_000e18));
        router.swapExactIn(address(usdc), address(wavax), amountIn, 0, 0, treasury);
    }

    function test_MockRouter_Sweep() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        router.sweep(IERC20(address(wavax)), attacker, 1);
        vm.expectEmit(address(router));
        emit MockRouter.Swept(address(wavax), mockOwner, 10e18);
        vm.prank(mockOwner);
        router.sweep(IERC20(address(wavax)), mockOwner, 10e18);
        assertEq(wavax.balanceOf(mockOwner), 10e18);
    }

    // ------------------------------------------- with AgentVault (S1 / S4)

    function _swapBatch(uint256 amount, uint8 poolId, uint256 minOut) internal view returns (AgentVault.Call[] memory) {
        return _two(
            _approve(address(router), amount),
            AgentVault.Call(
                address(router),
                0,
                abi.encodeCall(
                    MockRouter.swapExactIn, (address(usdc), address(wavax), amount, minOut, poolId, address(vault))
                )
            )
        );
    }

    /// S1: approve 2 USDC + swap through pool 0, with a LOW verdict.
    function test_Vault_S1NormalSwap() public {
        uint256 expected = router.quote(address(usdc), address(wavax), 2e6, 0);
        _execWithVerdict(_swapBatch(2e6, 0, expected), 0);
        assertEq(wavax.balanceOf(address(vault)), expected);
        assertEq(usdc.balanceOf(address(vault)), VAULT_USDC - 2e6);
        assertEq(usdc.allowance(address(vault), address(router)), 0);
    }

    /// S4: the same batch through pool 1 with minOut = 0 passes every static rule, so only the Guardian's
    /// HIGH verdict stops it.
    function test_Vault_S4BadSlippageStoppedOnlyByVerdictRisk() public {
        AgentVault.Call[] memory calls = _swapBatch(2e6, 1, 0);
        _execWithVerdictExpectRevert(calls, 2, abi.encodeWithSelector(AgentVault.RiskTooHigh.selector, uint8(2)));
        // Without a verdict the approval makes it sensitive.
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(calls);
        assertEq(usdc.balanceOf(address(vault)), VAULT_USDC);
    }
}
