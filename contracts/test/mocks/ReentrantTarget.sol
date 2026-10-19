// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AgentVault} from "../../src/AgentVault.sol";

/// @notice TEST ONLY: a malicious target that calls back into the vault while the vault is calling it.
contract ReentrantTarget {
    enum Mode {
        ExecuteBatch,
        OwnerExecute,
        Withdraw,
        SetAgent
    }

    AgentVault public immutable vault;
    Mode public mode;

    constructor(AgentVault vault_) {
        vault = vault_;
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    /// @notice Entry point when this contract is the vault's agent or owner.
    function start() external {
        AgentVault.Call[] memory calls = _attackCalls();
        if (mode == Mode.OwnerExecute) vault.ownerExecute(calls);
        else vault.executeBatch(calls, _noVerdict(), "");
    }

    /// @notice Called by the vault; re-enters it according to `mode`.
    function attack() external {
        if (mode == Mode.ExecuteBatch) vault.executeBatch(_attackCalls(), _noVerdict(), "");
        else if (mode == Mode.OwnerExecute) vault.ownerExecute(_attackCalls());
        else if (mode == Mode.Withdraw) vault.withdrawNative(payable(address(this)), address(vault).balance);
        else vault.setAgent(address(this));
    }

    function _attackCalls() private view returns (AgentVault.Call[] memory calls) {
        calls = new AgentVault.Call[](1);
        calls[0] = AgentVault.Call({target: address(this), value: 0, data: abi.encodeCall(this.attack, ())});
    }

    function _noVerdict() private pure returns (AgentVault.Verdict memory v) {}

    receive() external payable {}
}
