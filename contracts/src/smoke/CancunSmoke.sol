// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CancunSmoke
/// @notice Toolchain smoke test only, not part of AgentVault. Deployed once on Fuji at the start of P1 to
/// prove the chain executes the Cancun opcodes our build relies on (SPEC §4, §16): TSTORE/TLOAD (EIP-1153)
/// and MCOPY (EIP-5656). Compiling with evm_version = "cancun" is not enough: an unsupported opcode only
/// fails when it runs, so each check executes it in a transaction and stores the result.
contract CancunSmoke {
    bytes32 private constant TRANSIENT_SLOT = keccak256("guardian402.smoke.transient");

    uint256 public lastTransientValue;
    bytes32 public lastCopyHash;
    uint256 public lastCopyLength;

    event TransientChecked(uint256 value);
    event McopyChecked(bytes32 hash, uint256 length);

    error TransientMismatch(uint256 stored, uint256 loaded);
    error McopyMismatch(bytes32 expected, bytes32 actual);

    /// @notice Writes `value` with TSTORE, reads it back with TLOAD, and stores what was read.
    function checkTransient(uint256 value) external returns (uint256 loaded) {
        loaded = _tstoreThenTload(TRANSIENT_SLOT, value);
        if (loaded != value) revert TransientMismatch(value, loaded);
        lastTransientValue = loaded;
        // forge-lint: disable-next-line(reentrancy-events) -- no external call here; the lint counts inline assembly as one
        emit TransientChecked(loaded);
    }

    /// @notice Reads the transient slot with TLOAD. Called in a later transaction or eth_call it must
    /// return 0, because transient storage is cleared at the end of every transaction.
    function peekTransient() external view returns (uint256 value) {
        bytes32 slot = TRANSIENT_SLOT;
        assembly {
            value := tload(slot)
        }
    }

    /// @notice Copies `data` from one memory buffer to another with MCOPY and checks the copy.
    function checkMcopy(bytes calldata data) external returns (bytes32 hash) {
        bytes memory src = data;
        bytes memory dst = new bytes(src.length);
        _mcopy(dst, src);
        bytes32 expected = keccak256(src);
        hash = keccak256(dst);
        if (hash != expected) revert McopyMismatch(expected, hash);
        lastCopyHash = hash;
        lastCopyLength = dst.length;
        // forge-lint: disable-next-line(reentrancy-events) -- no external call here; the lint counts inline assembly as one
        emit McopyChecked(hash, dst.length);
    }

    function _tstoreThenTload(bytes32 slot, uint256 value) private returns (uint256 loaded) {
        assembly {
            tstore(slot, value)
            loaded := tload(slot)
        }
    }

    /// @dev Copies src's bytes into dst; dst must be at least as long as src.
    function _mcopy(bytes memory dst, bytes memory src) private pure {
        assembly {
            mcopy(add(dst, 0x20), add(src, 0x20), mload(src))
        }
    }
}
