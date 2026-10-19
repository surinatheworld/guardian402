// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockOracle
/// @notice DEMO ONLY (DEMO_MODE): an owner-set reference price, in USDC units (6 decimals) per 1 mWAVAX
/// (1e18 units). MockRouter quotes against it and the Guardian's ABNORMAL_SLIPPAGE rule compares to it.
contract MockOracle is Ownable {
    uint8 public constant PRICE_DECIMALS = 6;

    uint256 public price;

    event PriceSet(uint256 price);

    error ZeroPrice();

    constructor(address initialOwner, uint256 initialPrice) Ownable(initialOwner) {
        _setPrice(initialPrice);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        _setPrice(newPrice);
    }

    function _setPrice(uint256 newPrice) private {
        if (newPrice == 0) revert ZeroPrice();
        price = newPrice;
        emit PriceSet(newPrice);
    }
}
