// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AgentVault} from "./AgentVault.sol";

/// @title VaultFactory
/// @notice Lets anyone create their own AgentVault in one transaction: the caller becomes its owner, with the
/// agent, the Guardian (verdict signer) and the policy the caller passes. The factory keeps no rights over the
/// vaults it creates; it only records which vaults an owner created.
/// @dev The Guardian is chosen per vault because each deployment of the Guardian API has its own signing key
/// (the dashboard passes the signer its Guardian reports); the owner could set it with `setGuardian` anyway.
contract VaultFactory {
    mapping(address owner => address[] vaults) private _vaultsOf;
    address[] private _allVaults;

    event VaultCreated(address indexed owner, address indexed vault, address indexed agent, address guardian);

    error ZeroGuardian();

    /// @notice Creates a vault owned by the caller. `agent` may be zero (no agent yet); `guardian` may not.
    function createVault(address agent, address guardian, AgentVault.Config calldata config)
        external
        returns (AgentVault vault)
    {
        if (guardian == address(0)) revert ZeroGuardian();
        vault = new AgentVault(msg.sender, agent, guardian, config);
        _vaultsOf[msg.sender].push(address(vault));
        _allVaults.push(address(vault));
        // forge-lint: disable-next-line(reentrancy-events) -- the vault address only exists after `new`
        emit VaultCreated(msg.sender, address(vault), agent, guardian);
    }

    /// @notice Vaults created by `owner` through this factory, oldest first. Ownership may have moved since.
    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsOf[owner];
    }

    function vaultCount() external view returns (uint256) {
        return _allVaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _allVaults[index];
    }
}
