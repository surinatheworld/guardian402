// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockERC20
/// @notice DEMO ONLY (DEMO_MODE): a testnet token with no value, e.g. "Mock Wrapped AVAX" (mWAVAX, 18 decimals),
/// used as the swap output of MockRouter. Only the owner can mint.
contract MockERC20 is ERC20, Ownable {
    /// @notice Shown on the explorer so nobody mistakes this token for something of value.
    string public constant NOTICE = "DEMO ONLY: Guardian402 testnet mock token, no value";

    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address initialOwner)
        ERC20(name_, symbol_)
        Ownable(initialOwner)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
