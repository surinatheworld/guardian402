// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockOracle} from "./MockOracle.sol";

/// @title MockRouter
/// @notice DEMO ONLY (DEMO_MODE): a swap router with two fake pools for USDC -> mWAVAX only.
/// The quote is the MockOracle price made worse by the pool's skew: pool 0 is a normal pool (30 bps worse),
/// pool 1 is a thin, manipulated pool (3,000 bps worse) used by scenario S4. Output is paid from the router's
/// own mWAVAX inventory; the USDC it receives stays here until the owner sweeps it.
contract MockRouter is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant POOL0_SKEW_BPS = 30;
    uint256 public constant POOL1_SKEW_BPS = 3_000;

    IERC20 public immutable usdc;
    IERC20 public immutable wavax;
    MockOracle public immutable oracle;

    event Swapped(
        address indexed sender, address indexed to, uint8 indexed poolId, uint256 amountIn, uint256 amountOut
    );
    event Swept(address indexed token, address indexed to, uint256 amount);

    error UnsupportedPair(address tokenIn, address tokenOut);
    error UnknownPool(uint8 poolId);
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error InsufficientInventory(uint256 needed, uint256 available);

    constructor(IERC20 usdc_, IERC20 wavax_, MockOracle oracle_, address initialOwner) Ownable(initialOwner) {
        usdc = usdc_;
        wavax = wavax_;
        oracle = oracle_;
    }

    function skewBps(uint8 poolId) public pure returns (uint256) {
        if (poolId == 0) return POOL0_SKEW_BPS;
        if (poolId == 1) return POOL1_SKEW_BPS;
        revert UnknownPool(poolId);
    }

    /// @notice mWAVAX out for `amountIn` USDC through `poolId`.
    function quote(address tokenIn, address tokenOut, uint256 amountIn, uint8 poolId)
        public
        view
        returns (uint256 amountOut)
    {
        if (tokenIn != address(usdc) || tokenOut != address(wavax)) revert UnsupportedPair(tokenIn, tokenOut);
        amountOut = amountIn * 1e18 * (BPS - skewBps(poolId)) / (oracle.price() * BPS);
    }

    /// @notice Pulls `amountIn` USDC from the caller and pays the quoted mWAVAX to `to`.
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint8 poolId, address to)
        external
        returns (uint256 amountOut)
    {
        amountOut = quote(tokenIn, tokenOut, amountIn, poolId);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        uint256 inventory = wavax.balanceOf(address(this));
        if (amountOut > inventory) revert InsufficientInventory(amountOut, inventory);
        emit Swapped(msg.sender, to, poolId, amountIn, amountOut);
        usdc.safeTransferFrom(msg.sender, address(this), amountIn);
        wavax.safeTransfer(to, amountOut);
    }

    /// @notice Recovers tokens held by the router (the USDC it was paid, or unused inventory).
    function sweep(IERC20 token, address to, uint256 amount) external onlyOwner {
        emit Swept(address(token), to, amount);
        token.safeTransfer(to, amount);
    }
}
