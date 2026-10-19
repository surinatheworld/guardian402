// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Phase P0 toolchain check: the OpenZeppelin modules AgentVault will use (SPEC §4, P1)
/// compile with solc 0.8.28 and evm_version = "cancun". No business logic.
contract ToolchainProbe is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    constructor() Ownable(msg.sender) EIP712("Guardian402 AgentVault", "1") {}

    function recover(bytes32 structHash, bytes calldata signature) external view returns (address) {
        return ECDSA.recover(_hashTypedDataV4(structHash), signature);
    }
}

contract ToolchainTest is Test {
    function test_OpenZeppelinModulesCompileOnCancun() public {
        ToolchainProbe probe = new ToolchainProbe();
        assertEq(probe.owner(), address(this));

        uint256 pk = 0xA11CE;
        bytes32 structHash = keccak256("probe");
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            probe.eip712Domain();
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifyingContract
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash)));
        assertEq(probe.recover(structHash, abi.encodePacked(r, s, v)), vm.addr(pk));
    }
}
