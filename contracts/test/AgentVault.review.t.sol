// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {MockTarget} from "./mocks/MockTarget.sol";
import {AgentVaultBase} from "./utils/AgentVaultBase.sol";

/// @notice TEST ONLY: stands for any DEX entry point that is payable and takes the output recipient as an
/// argument (the usual shape of `swapExactNativeForTokens(..., to, ...)`). It simply forwards the value.
contract PayableSwapTarget {
    function swapNativeTo(address payable to) external payable {
        (bool ok,) = to.call{value: msg.value}("");
        require(ok, "forward failed");
    }
}

/// @notice TEST ONLY: a token that reports failure by returning false instead of reverting.
contract FalseReturningToken {
    mapping(address account => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function approve(address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @notice TEST ONLY: a token whose transfer returns nothing (the USDT shape).
contract NoReturnToken {
    mapping(address account => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}

/// @notice TEST ONLY: a token whose transfer answers with a single byte, which is not an ABI-encoded bool.
contract ShortReturnToken {
    mapping(address account => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        return hex"01";
    }
}

/// @notice TEST ONLY: charges the sender a 1% fee on top of every transfer.
contract FeeOnTopToken is ERC20 {
    address public constant SINK = address(0xFEE);

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) super._update(from, SINK, value / 100);
        super._update(from, to, value);
    }
}

/// Second review of AgentVault (2026-11-11, docs/THREAT_MODEL.md "Findings of the second review"). Each
/// `test_Review_R*` test reproduced one finding (it failed before the fix) and keeps guarding the fix.
/// `test_ReviewOk_*` tests back the "checked and fine" list of the review.
///
/// The fixture adds the DEMO router exactly as `script/Seed.s.sol` does on Fuji: allowed target with the
/// `swapExactIn` selector, and allowed recipient so that it can be approved.
contract AgentVaultReviewTest is AgentVaultBase {
    MockERC20 internal wavax;
    MockRouter internal router;

    function setUp() public override {
        super.setUp();
        wavax = new MockERC20("Mock Wrapped AVAX", "mWAVAX", 18, address(this));
        MockOracle oracle = new MockOracle(address(this), 25e6);
        router = new MockRouter(IERC20(address(usdc)), IERC20(address(wavax)), oracle, address(this));
        wavax.mint(address(router), 1_000e18);

        vm.startPrank(owner);
        vault.setAllowedTarget(address(router), true);
        vault.setAllowedSelector(address(router), MockRouter.swapExactIn.selector, true);
        vault.setAllowedRecipient(address(router), true);
        vm.stopPrank();
    }

    /// @dev USDC -> mWAVAX through the thin pool, no slippage limit, output to `to`.
    function _swap(uint256 amountIn, address to) internal view returns (AgentVault.Call memory) {
        return AgentVault.Call(
            address(router),
            0,
            abi.encodeCall(MockRouter.swapExactIn, (address(usdc), address(wavax), amountIn, 0, 1, to))
        );
    }

    function _track(address token) internal {
        vm.prank(owner);
        vault.setTokenPolicy(token, true, USDC_CAP, USDC_MAX_APPROVAL, USDC_THRESHOLD);
    }

    function _tokenTransfer(address token, uint256 amount) internal view returns (AgentVault.Call[] memory) {
        return _one(AgentVault.Call(token, 0, abi.encodeCall(IERC20.transfer, (treasury, amount))));
    }

    // ------------------------------------------------------------------------------------- findings

    /// R1 (Medium): native value needs no approval, so the F1 fix did not cover it. A batch that sent AVAX at or
    /// below the native verdict threshold to an allowlisted payable target needed no verdict, and the vault
    /// cannot check the target's arguments: with a payable entry point that takes an output recipient, the
    /// agent key alone moved the whole native daily cap to an address on no allowlist.
    /// Fix: a batch that reaches an allowed target needs a verdict for any outflow.
    function test_Review_R1_NativeValueToTargetNeedsVerdict() public {
        PayableSwapTarget dex = new PayableSwapTarget();
        vm.startPrank(owner);
        vault.setAllowedTarget(address(dex), true); // a target only: not an allowed recipient
        vault.setAllowedSelector(address(dex), PayableSwapTarget.swapNativeTo.selector, true);
        vm.stopPrank();
        bytes memory data = abi.encodeCall(PayableSwapTarget.swapNativeTo, (payable(attacker)));

        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(AgentVault.Call(address(dex), NATIVE_THRESHOLD, data)));
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(AgentVault.Call(address(dex), 1, data)));
        assertEq(attacker.balance, 0);
        assertEq(vault.spent(address(0), _today()), 0);
    }

    /// R1: the Guardian decides. With a verdict the same call runs, inside the native cap.
    function test_Review_R1_NativeValueToTargetRunsWithVerdict() public {
        _execWithVerdict(_one(_ping(NATIVE_THRESHOLD)), 0);
        assertEq(target.lastValue(), NATIVE_THRESHOLD);
        assertEq(vault.spent(address(0), _today()), NATIVE_THRESHOLD);
    }

    /// R1: a call to an allowed target that moves nothing out still needs no verdict.
    function test_Review_R1_TargetCallWithoutOutflowNeedsNoVerdict() public {
        _exec(_one(_ping(0)));
        assertEq(target.pings(), 1);
        assertEq(vault.verdictNonce(), 0);
    }

    /// R1: one call to a target makes the whole batch strict, also for a small payment to a plain recipient.
    function test_Review_R1_TargetCallMakesTheWholeBatchStrict() public {
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_two(_ping(0), _transfer(treasury, 1)));
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_two(_native(treasury, 1), _ping(0)));

        _exec(_one(_transfer(treasury, USDC_THRESHOLD))); // alone, the payment still needs no verdict
        assertEq(usdc.balanceOf(treasury), USDC_THRESHOLD);
    }

    /// R2 (Low): F1 was closed only for approvals granted on the agent path. An allowance the owner grants with
    /// `ownerExecute` (kept on purpose, see test_Audit_F1_OwnerApprovalsAreKept) reopened it: swaps at or below
    /// the threshold needed no verdict and their output went anywhere. Same fix as R1.
    function test_Review_R2_OwnerGrantedAllowanceNeedsVerdict() public {
        vm.prank(owner);
        vault.ownerExecute(_one(_approve(address(router), USDC_MAX_APPROVAL)));

        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(_swap(USDC_THRESHOLD, attacker)));
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(_swap(1, attacker)));
        assertEq(wavax.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(address(vault)), VAULT_USDC);
        assertEq(usdc.allowance(address(vault), address(router)), USDC_MAX_APPROVAL, "the owner's allowance is kept");
    }

    /// R3 (Low): one list answers "may be approved" and "may be paid". The router has to be an allowed recipient
    /// to be approved (SPEC §4.8), so the agent could also transfer tokens straight into it with no verdict, up
    /// to the daily cap. Fix: a transfer to an address that is also an allowed target makes the batch strict.
    function test_Review_R3_TransferToTargetNeedsVerdict() public {
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(_transfer(address(router), USDC_THRESHOLD)));
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(_transfer(address(router), 1)));
        assertEq(usdc.balanceOf(address(router)), 0);

        _execWithVerdict(_one(_transfer(address(router), USDC_THRESHOLD)), 0);
        assertEq(usdc.balanceOf(address(router)), USDC_THRESHOLD);
    }

    /// R3, native: a plain native transfer to a recipient that is also an allowed target.
    function test_Review_R3_PlainNativeToTargetNeedsVerdict() public {
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(_one(_native(address(target), 1)));

        _execWithVerdict(_one(_native(address(target), NATIVE_THRESHOLD)), 0);
        assertEq(address(target).balance, NATIVE_THRESHOLD);
    }

    /// R3: a zero-amount transfer to a target moves nothing and needs no verdict.
    function test_Review_R3_ZeroTransferToTargetNeedsNoVerdict() public {
        _exec(_one(_transfer(address(router), 0)));
        assertEq(vault.verdictNonce(), 0);
    }

    /// R4 (Low): `_run` checked only the success flag of the low-level call, so a tracked token that returns
    /// false made the batch "succeed": `Executed` was emitted and nothing had moved.
    /// Fix: on the agent path a tracked token must return nothing or true, as SafeERC20 requires.
    function test_Review_R4_TokenReturningFalseFailsTheBatch() public {
        FalseReturningToken token = new FalseReturningToken();
        token.mint(address(vault), 10e6);
        _track(address(token));

        vm.expectRevert(abi.encodeWithSelector(AgentVault.CallFailed.selector, 0, abi.encode(false)));
        _exec(_tokenTransfer(address(token), 1e6));
    }

    function test_Review_R4_TokenReturningGarbageFailsTheBatch() public {
        ShortReturnToken token = new ShortReturnToken();
        token.mint(address(vault), 10e6);
        _track(address(token));

        vm.expectRevert(abi.encodeWithSelector(AgentVault.CallFailed.selector, 0, hex"01"));
        _exec(_tokenTransfer(address(token), 1e6));
    }

    /// R4: a token that returns nothing (the USDT shape) still works.
    function test_Review_R4_TokenReturningNothingStillWorks() public {
        NoReturnToken token = new NoReturnToken();
        token.mint(address(vault), 10e6);
        _track(address(token));

        _exec(_tokenTransfer(address(token), 1e6));
        assertEq(token.balanceOf(treasury), 1e6);
        assertEq(vault.spent(address(token), _today()), 1e6);
    }

    /// R4 does not touch the owner path: the human override runs any call and reads no return value.
    function test_Review_R4_OwnerPathIsNotChecked() public {
        FalseReturningToken token = new FalseReturningToken();
        _track(address(token));

        vm.prank(owner);
        vault.ownerExecute(_tokenTransfer(address(token), 1e6));
    }

    /// R5 (Info): removing a target kept its selectors in storage, so allowing the target again later brought
    /// every old selector back with no transaction or event for them.
    /// Fix: removing a target removes its selectors, with one `AllowedSelectorSet(.., false)` event each.
    function test_Review_R5_RemovingTargetRemovesItsSelectors() public {
        vm.startPrank(owner);
        vm.expectEmit(address(vault));
        emit AgentVault.AllowedSelectorSet(address(router), MockRouter.swapExactIn.selector, false);
        vm.expectEmit(address(vault));
        emit AgentVault.AllowedTargetSet(address(router), false);
        vault.setAllowedTarget(address(router), false);
        assertFalse(vault.allowedSelector(address(router), MockRouter.swapExactIn.selector));

        vault.setAllowedTarget(address(target), false);
        vault.setAllowedTarget(address(target), true);
        vm.stopPrank();

        assertFalse(vault.allowedSelector(address(target), MockTarget.ping.selector));
        assertFalse(vault.allowedSelector(address(target), MockTarget.pull.selector));
        assertFalse(vault.allowedSelector(address(target), MockTarget.refund.selector));
        assertFalse(vault.allowedSelector(address(target), MockTarget.fail.selector));
        vm.expectRevert(
            abi.encodeWithSelector(AgentVault.SelectorNotAllowed.selector, address(target), MockTarget.ping.selector)
        );
        _exec(_one(_ping(0)));
    }

    /// R5: `getPolicy()` shows the re-allowed target with an empty selector list.
    function test_Review_R5_GetPolicyShowsNoSelectorAfterReAllow() public {
        vm.startPrank(owner);
        vault.setAllowedTarget(address(router), false);
        vault.setAllowedTarget(address(router), true);
        vm.stopPrank();

        AgentVault.Policy memory p = vault.getPolicy();
        for (uint256 i; i < p.targets.length; ++i) {
            if (p.targets[i].target == address(router)) assertEq(p.targets[i].selectors.length, 0);
        }
    }

    // ----------------------------------------------------------------------------- checked and fine

    /// A verdict signed for another vault with the same owner, agent, guardian and nonce is rejected.
    function test_ReviewOk_VerdictForAnotherVaultIsRejected() public {
        AgentVault.Config memory emptyConfig;
        AgentVault other = new AgentVault(owner, agent, guardian, emptyConfig);
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        (uint8 r8, bytes32 r, bytes32 s) = vm.sign(GUARDIAN_PK, other.verdictDigest(v));

        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, abi.encodePacked(r, s, r8));
    }

    /// A verdict signed for one chain id is rejected once the chain id differs (the domain is rebuilt).
    function test_ReviewOk_VerdictForAnotherChainIsRejected() public {
        AgentVault.Call[] memory calls = _one(_transfer(treasury, 5e6));
        AgentVault.Verdict memory v = _verdictFor(calls, 0);
        bytes memory sig = _signWith(GUARDIAN_PK, v);

        vm.chainId(43114);
        vm.expectRevert(AgentVault.BadSignature.selector);
        _execSigned(calls, v, sig);
    }

    /// Fee-on-transfer: the threshold and the cap count what really left the vault, not the amount argument.
    function test_ReviewOk_FeeOnTransferCountsTheRealOutflow() public {
        FeeOnTopToken token = new FeeOnTopToken();
        token.mint(address(vault), 10e6);
        _track(address(token));
        AgentVault.Call[] memory calls = _tokenTransfer(address(token), USDC_THRESHOLD);

        // 1.00 sent + 0.01 fee = 1.01 out, above the 1.00 threshold.
        vm.expectRevert(AgentVault.VerdictRequired.selector);
        _exec(calls);

        _execWithVerdict(calls, 0);
        assertEq(vault.spent(address(token), _today()), USDC_THRESHOLD + USDC_THRESHOLD / 100);
    }

    /// The vault is not an ERC-1271 signer, so signature-based token entry points that accept contract
    /// signatures (permit, transferWithAuthorization) cannot be used against it.
    function test_ReviewOk_VaultIsNotAnErc1271Signer() public view {
        (bool ok,) =
            address(vault).staticcall(abi.encodeWithSignature("isValidSignature(bytes32,bytes)", bytes32(0), ""));
        assertFalse(ok);
    }

    /// Owner rule 3 while a handoff is pending: the pending owner has no power yet, the current owner can still
    /// empty the vault, paused or not.
    function test_ReviewOk_PendingHandoffKeepsOwnerWithdrawals() public {
        address lead = makeAddr("lead");
        vm.startPrank(owner);
        vault.transferOwnership(lead);
        vault.pause();
        vm.stopPrank();

        vm.prank(lead);
        vm.expectRevert();
        vault.withdraw(address(usdc), lead, VAULT_USDC);

        vm.startPrank(owner);
        vault.withdraw(address(usdc), owner, VAULT_USDC);
        vault.withdrawNative(payable(owner), VAULT_NATIVE);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(address(vault).balance, 0);
    }
}
