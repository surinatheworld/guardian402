// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AgentVault} from "./AgentVault.sol";

/// @title VaultFactory
/// @notice Lets anyone create their own AgentVault in one transaction: the caller becomes its owner, the
/// Guardian of this factory becomes its guardian, and the vault starts with the caller's policy. The factory
/// keeps no rights over the vaults it creates; it only records which vaults an owner created.
contract VaultFactory {
    /// @notice Verdict signer set on every vault this factory creates; the owner can change it on the vault.
    address public immutable guardian;

    mapping(address owner => address[] vaults) private _vaultsOf;
    address[] private _allVaults;

    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);

    error ZeroGuardian();

    constructor(address guardian_) {
        if (guardian_ == address(0)) revert ZeroGuardian();
        guardian = guardian_;
    }

    /// @notice Creates a vault owned by the caller. `agent` may be zero (no agent yet).
    function createVault(address agent, AgentVault.Config calldata config) external returns (AgentVault vault) {
        vault = new AgentVault(msg.sender, agent, guardian, config);
        _vaultsOf[msg.sender].push(address(vault));
        _allVaults.push(address(vault));
        // forge-lint: disable-next-line(reentrancy-events) -- the vault address only exists after `new`
        emit VaultCreated(msg.sender, address(vault), agent);
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
