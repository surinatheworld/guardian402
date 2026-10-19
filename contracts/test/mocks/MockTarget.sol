// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice TEST ONLY: a protocol the vault may call. `pull` spends an approval like a router does.
contract MockTarget {
    error Boom(uint256 code);

    uint256 public pings;
    uint256 public lastValue;

    function ping(uint256 x) external payable returns (uint256) {
        ++pings;
        lastValue = msg.value;
        return x;
    }

    /// @notice Pulls `amount` of `token` from the caller using its approval.
    function pull(IERC20 token, uint256 amount) external {
        require(token.transferFrom(msg.sender, address(this), amount), "pull failed");
    }

    /// @notice Sends `amount` of `token` back to the caller (an inflow for the vault).
    function refund(IERC20 token, uint256 amount) external {
        require(token.transfer(msg.sender, amount), "refund failed");
    }

    function fail(uint256 code) external pure {
        revert Boom(code);
    }

    receive() external payable {}
}
