// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title AgentVault
/// @notice Holds an owner's funds and runs an AI agent's call batches only when they pass the on-chain policy
/// (allowlists, daily caps, kill switch) and, when required, carry a valid EIP-712 verdict signed by the
/// Guardian (docs/SPEC.md §4). The owner can withdraw at any time; the Guardian can only sign verdicts.
contract AgentVault is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // ---------------------------------------------------------------- types

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct Verdict {
        bytes32 callsHash; // keccak256(abi.encode(calls)) with calls typed as Call[]
        uint256 nonce; // must equal verdictNonce at execution time
        uint64 deadline; // unix seconds; valid while block.timestamp <= deadline
        uint8 risk; // 0 = LOW, 1 = MEDIUM, 2 = HIGH
        bytes32 checkId; // Guardian check id, for the audit trail
    }

    /// @dev All amounts in token units.
    struct TokenPolicy {
        bool tracked;
        uint256 dailyCap;
        uint256 maxApproval;
        uint256 verdictThreshold;
    }

    struct TokenPolicyView {
        address token;
        uint256 dailyCap;
        uint256 maxApproval;
        uint256 verdictThreshold;
        uint256 spentToday;
        uint256 balance;
    }

    struct TargetView {
        address target;
        bytes4[] selectors;
    }

    /// @notice Everything the Guardian needs to pre-check a batch, read in one call.
    struct Policy {
        address owner;
        address pendingOwner;
        address agent;
        address guardian;
        bool paused;
        uint256 verdictNonce;
        uint8 maxAgentRisk;
        uint256 day;
        TokenPolicyView[] tokens;
        uint256 nativeDailyCap;
        uint256 nativeVerdictThreshold;
        uint256 nativeSpentToday;
        uint256 nativeBalance;
        TargetView[] targets;
        address[] recipients;
    }

    // ------------------------------------------------------------ constants

    bytes32 public constant VERDICT_TYPEHASH =
        keccak256("Verdict(bytes32 callsHash,uint256 nonce,uint64 deadline,uint8 risk,bytes32 checkId)");
    uint256 public constant MAX_CALLS = 8;
    uint256 public constant MAX_TRACKED_TOKENS = 8;
    uint8 public constant MAX_RISK = 2;
    /// @notice Key under which native AVAX outflow is tracked in `spent`.
    address public constant NATIVE = address(0);

    bytes4 private constant TRANSFER_SELECTOR = IERC20.transfer.selector;
    bytes4 private constant APPROVE_SELECTOR = IERC20.approve.selector;
    /// @dev 4-byte selector + (address, uint256).
    uint256 private constant TOKEN_CALL_LENGTH = 68;
    /// @dev Flags returned by `_checkCall`. SENSITIVE: an approval > 0. VIA_TARGET: the call reaches an allowed
    /// target, whose arguments and code the vault cannot check.
    uint256 private constant FLAG_SENSITIVE = 1;
    uint256 private constant FLAG_VIA_TARGET = 2;

    // ---------------------------------------------------------------- state

    address public agent;
    address public guardian;
    bool public paused;
    uint256 public verdictNonce;
    uint8 public maxAgentRisk;

    mapping(address token => TokenPolicy) public tokenPolicy;
    address[] public trackedTokens;
    uint256 public nativeDailyCap;
    uint256 public nativeVerdictThreshold;

    /// @notice token (NATIVE for AVAX) => day (block.timestamp / 1 days) => agent-path outflow.
    mapping(address token => mapping(uint256 day => uint256 amount)) public spent;

    EnumerableSet.AddressSet private _targets;
    mapping(address target => EnumerableSet.Bytes32Set) private _selectors;
    EnumerableSet.AddressSet private _recipients;

    // --------------------------------------------------------------- events

    event Executed(bytes32 indexed callsHash, bytes32 indexed checkId, bool withVerdict, uint256 nonceUsed);
    event OwnerExecuted(bytes32 indexed callsHash, uint256 callCount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event NativeWithdrawn(address indexed to, uint256 amount);
    event VaultPaused(address indexed by);
    event VaultUnpaused(address indexed by);
    event AgentSet(address indexed previousAgent, address indexed newAgent);
    event GuardianSet(address indexed previousGuardian, address indexed newGuardian);
    event MaxAgentRiskSet(uint8 maxAgentRisk);
    event TokenPolicySet(
        address indexed token, bool tracked, uint256 dailyCap, uint256 maxApproval, uint256 verdictThreshold
    );
    event NativePolicySet(uint256 dailyCap, uint256 verdictThreshold);
    event AllowedTargetSet(address indexed target, bool allowed);
    event AllowedSelectorSet(address indexed target, bytes4 indexed selector, bool allowed);
    event AllowedRecipientSet(address indexed recipient, bool allowed);

    // --------------------------------------------------------------- errors

    error Paused();
    error NotAgent();
    error BadBatch();
    error TargetNotAllowed(address target);
    error SelectorNotAllowed(address target, bytes4 selector);
    error RecipientNotAllowed(address recipient);
    error ApprovalTooLarge(address token, uint256 amount);
    error InvalidVerdict();
    error VerdictExpired();
    error BadSignature();
    error RiskTooHigh(uint8 risk);
    error DailyCapExceeded(address token, uint256 spent, uint256 cap);
    error CallFailed(uint256 index, bytes returndata);
    error VerdictRequired();
    error TooManyTrackedTokens();
    error RenounceDisabled();

    // ---------------------------------------------------------- constructor

    /// @dev A zero agent or guardian is valid: no agent means the agent path is revoked; no guardian means no
    /// verdict is accepted. The zero owner is rejected by Ownable.
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(address initialOwner, address initialAgent, address initialGuardian)
        Ownable(initialOwner)
        EIP712("Guardian402 AgentVault", "1")
    {
        agent = initialAgent;
        guardian = initialGuardian;
        emit AgentSet(address(0), initialAgent);
        emit GuardianSet(address(0), initialGuardian);
    }

    receive() external payable {}

    // ------------------------------------------------------------ agent path

    /// @notice Runs the agent's batch after the checks of SPEC §4.3, in that order. Reverts as a whole if any
    /// check fails, so no token leaves the vault.
    function executeBatch(Call[] calldata calls, Verdict calldata verdict, bytes calldata signature)
        external
        nonReentrant
    {
        // 1. caller and batch shape
        if (paused) revert Paused();
        if (msg.sender != agent) revert NotAgent();
        uint256 count = calls.length;
        if (count == 0 || count > MAX_CALLS) revert BadBatch();

        // 2. static policy
        uint256 flags = 0;
        for (uint256 i; i < count; ++i) {
            flags |= _checkCall(calls[i]);
        }

        // 3. verdict, consumed before any external call
        bytes32 callsHash = hashCalls(calls);
        bool withVerdict = signature.length > 0;
        uint256 nonceUsed = 0;
        if (withVerdict) {
            nonceUsed = verdictNonce;
            _verifyVerdict(callsHash, verdict, signature);
        }

        // 4.–6. balances, calls, daily caps on the actual outflow
        uint256[] memory balancesBefore = _balances();
        _run(calls, true);
        _revokeApprovals(calls);
        bool needsVerdict = _recordOutflows(balancesBefore, flags & FLAG_VIA_TARGET != 0);

        // 7. verdict required for approvals, for large outflows, and for any outflow of a batch that reaches an
        // allowed target
        if ((needsVerdict || flags & FLAG_SENSITIVE != 0) && !withVerdict) revert VerdictRequired();

        // 8. After the calls by design (SPEC §4.3); reentrancy is blocked by nonReentrant.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Executed(callsHash, withVerdict ? verdict.checkId : bytes32(0), withVerdict, nonceUsed);
    }

    // ------------------------------------------------------------ owner path

    /// @notice The human override: runs any calls with no policy.
    function ownerExecute(Call[] calldata calls) external nonReentrant onlyOwner {
        _run(calls, false);
        // forge-lint: disable-next-line(reentrancy-events)
        emit OwnerExecuted(hashCalls(calls), calls.length);
    }

    /// @notice Works while paused.
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        emit Withdrawn(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Works while paused.
    function withdrawNative(address payable to, uint256 amount) external onlyOwner {
        emit NativeWithdrawn(to, amount);
        Address.sendValue(to, amount);
    }

    /// @notice Kill switch: blocks the agent path only. Owner functions keep working.
    function pause() external onlyOwner {
        paused = true;
        emit VaultPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit VaultUnpaused(msg.sender);
    }

    /// @notice `setAgent(address(0))` revokes the agent.
    // forge-lint: disable-next-line(missing-zero-check)
    function setAgent(address newAgent) external onlyOwner {
        emit AgentSet(agent, newAgent);
        agent = newAgent;
    }

    /// @notice `setGuardian(address(0))` makes every verdict fail, so only batches that need no verdict run.
    // forge-lint: disable-next-line(missing-zero-check)
    function setGuardian(address newGuardian) external onlyOwner {
        emit GuardianSet(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setMaxAgentRisk(uint8 newMaxAgentRisk) external onlyOwner {
        if (newMaxAgentRisk > MAX_RISK) revert RiskTooHigh(newMaxAgentRisk);
        maxAgentRisk = newMaxAgentRisk;
        emit MaxAgentRiskSet(newMaxAgentRisk);
    }

    function setTokenPolicy(
        address token,
        bool tracked,
        uint256 dailyCap,
        uint256 maxApproval,
        uint256 verdictThreshold
    ) external onlyOwner {
        // address(0) is the native key; the vault itself is never a valid token target.
        if (token == NATIVE || token == address(this)) revert TargetNotAllowed(token);
        bool wasTracked = tokenPolicy[token].tracked;
        if (tracked && !wasTracked) {
            if (trackedTokens.length >= MAX_TRACKED_TOKENS) revert TooManyTrackedTokens();
            trackedTokens.push(token);
        } else if (!tracked && wasTracked) {
            _untrack(token);
        }
        tokenPolicy[token] = TokenPolicy(tracked, dailyCap, maxApproval, verdictThreshold);
        emit TokenPolicySet(token, tracked, dailyCap, maxApproval, verdictThreshold);
    }

    function setNativePolicy(uint256 dailyCap, uint256 verdictThreshold) external onlyOwner {
        nativeDailyCap = dailyCap;
        nativeVerdictThreshold = verdictThreshold;
        emit NativePolicySet(dailyCap, verdictThreshold);
    }

    /// @notice Removing a target also removes its selectors (review finding R5), so allowing it again later
    /// starts from an empty selector list.
    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        if (allowed) {
            _targets.add(target);
        } else {
            _targets.remove(target);
            EnumerableSet.Bytes32Set storage selectors = _selectors[target];
            bytes32[] memory removed = selectors.values();
            selectors.clear();
            for (uint256 i; i < removed.length; ++i) {
                // forge-lint: disable-next-line(unsafe-typecast) -- selectors are stored left-aligned, so this is lossless
                emit AllowedSelectorSet(target, bytes4(removed[i]), false);
            }
        }
        emit AllowedTargetSet(target, allowed);
    }

    function setAllowedSelector(address target, bytes4 selector, bool allowed) external onlyOwner {
        allowed ? _selectors[target].add(selector) : _selectors[target].remove(selector);
        emit AllowedSelectorSet(target, selector, allowed);
    }

    function setAllowedRecipient(address recipient, bool allowed) external onlyOwner {
        allowed ? _recipients.add(recipient) : _recipients.remove(recipient);
        emit AllowedRecipientSet(recipient, allowed);
    }

    /// @notice Disabled: an ownerless vault could never be withdrawn from.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ----------------------------------------------------------------- views

    function allowedTarget(address target) external view returns (bool) {
        return _targets.contains(target);
    }

    function allowedSelector(address target, bytes4 selector) external view returns (bool) {
        return _selectors[target].contains(selector);
    }

    function allowedRecipient(address recipient) external view returns (bool) {
        return _recipients.contains(recipient);
    }

    function trackedTokenCount() external view returns (uint256) {
        return trackedTokens.length;
    }

    /// @notice Agent-path budget left today. NATIVE for AVAX; 0 for a token that is not tracked.
    function remainingToday(address token) external view returns (uint256) {
        uint256 cap;
        if (token == NATIVE) cap = nativeDailyCap;
        else if (tokenPolicy[token].tracked) cap = tokenPolicy[token].dailyCap;
        else return 0;
        uint256 used = spent[token][_today()];
        return used >= cap ? 0 : cap - used;
    }

    function hashCalls(Call[] calldata calls) public pure returns (bytes32) {
        return keccak256(abi.encode(calls));
    }

    function verdictDigest(Verdict calldata verdict) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    VERDICT_TYPEHASH, verdict.callsHash, verdict.nonce, verdict.deadline, verdict.risk, verdict.checkId
                )
            )
        );
    }

    function getPolicy() external view returns (Policy memory p) {
        uint256 day = _today();
        p.owner = owner();
        p.pendingOwner = pendingOwner();
        p.agent = agent;
        p.guardian = guardian;
        p.paused = paused;
        p.verdictNonce = verdictNonce;
        p.maxAgentRisk = maxAgentRisk;
        p.day = day;

        uint256 tokenCount = trackedTokens.length;
        p.tokens = new TokenPolicyView[](tokenCount);
        for (uint256 i; i < tokenCount; ++i) {
            address token = trackedTokens[i];
            TokenPolicy storage tp = tokenPolicy[token];
            p.tokens[i] = TokenPolicyView({
                token: token,
                dailyCap: tp.dailyCap,
                maxApproval: tp.maxApproval,
                verdictThreshold: tp.verdictThreshold,
                spentToday: spent[token][day],
                balance: IERC20(token).balanceOf(address(this))
            });
        }

        p.nativeDailyCap = nativeDailyCap;
        p.nativeVerdictThreshold = nativeVerdictThreshold;
        p.nativeSpentToday = spent[NATIVE][day];
        p.nativeBalance = address(this).balance;

        uint256 targetCount = _targets.length();
        p.targets = new TargetView[](targetCount);
        for (uint256 i; i < targetCount; ++i) {
            address target = _targets.at(i);
            bytes32[] memory raw = _selectors[target].values();
            bytes4[] memory selectors = new bytes4[](raw.length);
            for (uint256 j; j < raw.length; ++j) {
                // forge-lint: disable-next-line(unsafe-typecast) -- selectors are stored left-aligned, so this is lossless
                selectors[j] = bytes4(raw[j]);
            }
            p.targets[i] = TargetView({target: target, selectors: selectors});
        }

        p.recipients = _recipients.values();
    }

    // -------------------------------------------------------------- internal

    /// @dev Step 2 for one call. Returns FLAG_SENSITIVE when the call is an approval > 0 and FLAG_VIA_TARGET
    /// when it reaches an allowed target: a call to it, native value sent to it, or a tracked-token transfer to
    /// it (review findings R1–R3).
    function _checkCall(Call calldata c) private view returns (uint256 flags) {
        address target = c.target;
        if (target == address(this) || target == address(0)) revert TargetNotAllowed(target);
        bool isTarget = _targets.contains(target);

        if (tokenPolicy[target].tracked) {
            flags = _checkTokenCall(target, c.data);
        } else if (c.data.length > 0) {
            if (!isTarget) revert TargetNotAllowed(target);
            if (c.data.length < 4) revert SelectorNotAllowed(target, bytes4(0));
            bytes4 selector = bytes4(c.data[:4]);
            if (!_selectors[target].contains(selector)) revert SelectorNotAllowed(target, selector);
            flags = FLAG_VIA_TARGET;
        } else {
            if (!_recipients.contains(target)) revert RecipientNotAllowed(target);
            if (isTarget) flags = FLAG_VIA_TARGET;
        }

        if (c.value > 0) {
            if (isTarget) flags |= FLAG_VIA_TARGET;
            else if (!_recipients.contains(target)) revert TargetNotAllowed(target);
        }
    }

    /// @dev Only transfer(address,uint256) and approve(address,uint256) with exactly ABI-encoded arguments.
    function _checkTokenCall(address token, bytes calldata data) private view returns (uint256 flags) {
        if (data.length < 4) revert SelectorNotAllowed(token, bytes4(0));
        bytes4 selector = bytes4(data[:4]);
        if (selector != TRANSFER_SELECTOR && selector != APPROVE_SELECTOR) revert SelectorNotAllowed(token, selector);
        if (data.length != TOKEN_CALL_LENGTH) revert SelectorNotAllowed(token, selector);
        (address to, uint256 amount) = abi.decode(data[4:], (address, uint256));

        if (selector == TRANSFER_SELECTOR) {
            if (!_recipients.contains(to)) revert RecipientNotAllowed(to);
            // A recipient that is also an allowed target is a protocol, not a payee.
            return _targets.contains(to) ? FLAG_VIA_TARGET : 0;
        }
        if (amount == 0) return 0; // revoking an approval is always allowed
        if (!_recipients.contains(to)) revert RecipientNotAllowed(to);
        if (amount > tokenPolicy[token].maxApproval) revert ApprovalTooLarge(token, amount);
        return FLAG_SENSITIVE;
    }

    /// @dev Step 3. Increments verdictNonce; the caller has made no external call yet.
    function _verifyVerdict(bytes32 callsHash, Verdict calldata verdict, bytes calldata signature) private {
        if (verdict.callsHash != callsHash) revert InvalidVerdict();
        if (verdict.nonce != verdictNonce) revert InvalidVerdict();
        if (block.timestamp > verdict.deadline) revert VerdictExpired();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(verdictDigest(verdict), signature);
        if (err != ECDSA.RecoverError.NoError || signer != guardian) revert BadSignature();
        if (verdict.risk > maxAgentRisk) revert RiskTooHigh(verdict.risk);
        ++verdictNonce;
    }

    /// @dev Step 4: balances of every tracked token, then the native balance last.
    function _balances() private view returns (uint256[] memory balances) {
        uint256 tokenCount = trackedTokens.length;
        balances = new uint256[](tokenCount + 1);
        for (uint256 i; i < tokenCount; ++i) {
            balances[i] = IERC20(trackedTokens[i]).balanceOf(address(this));
        }
        balances[tokenCount] = address(this).balance;
    }

    /// @dev `agentPath`: a tracked token must also return nothing or `true`, as SafeERC20 requires (review
    /// finding R4). A tracked token always has code: `_balances` has just called it.
    function _run(Call[] calldata calls, bool agentPath) private {
        for (uint256 i; i < calls.length; ++i) {
            address target = calls[i].target;
            // Agent path: every target and value passed _checkCall first. Owner path: the owner decides.
            // forge-lint: disable-next-line(arbitrary-send-eth)
            (bool ok, bytes memory returndata) = target.call{value: calls[i].value}(calls[i].data);
            if (ok && agentPath && tokenPolicy[target].tracked) ok = _returnedTrueOrNothing(returndata);
            if (!ok) revert CallFailed(i, returndata);
        }
    }

    function _returnedTrueOrNothing(bytes memory returndata) private pure returns (bool) {
        if (returndata.length == 0) return true;
        return returndata.length >= 32 && abi.decode(returndata, (uint256)) == 1;
    }

    /// @dev Approvals granted on the agent path never outlive their batch (P11 review, finding F1): whatever the
    /// batch did not use is revoked, so an allowlisted spender cannot be used later without a new verdict.
    /// `_checkCall` already required tracked-token calls to be exactly `selector + (address, uint256)`.
    function _revokeApprovals(Call[] calldata calls) private {
        for (uint256 i; i < calls.length; ++i) {
            Call calldata c = calls[i];
            if (!tokenPolicy[c.target].tracked || bytes4(c.data[:4]) != APPROVE_SELECTOR) continue;
            (address spender, uint256 amount) = abi.decode(c.data[4:], (address, uint256));
            if (amount > 0) IERC20(c.target).forceApprove(spender, 0);
        }
    }

    /// @dev Step 6. Returns true when any outflow is above its verdict threshold. `viaTarget`: the batch reaches
    /// an allowed target, so the threshold is zero and any outflow needs a verdict.
    function _recordOutflows(uint256[] memory balancesBefore, bool viaTarget) private returns (bool needsVerdict) {
        uint256 day = _today();
        uint256 tokenCount = trackedTokens.length;
        for (uint256 i; i < tokenCount; ++i) {
            address token = trackedTokens[i];
            TokenPolicy storage tp = tokenPolicy[token];
            uint256 balanceAfter = IERC20(token).balanceOf(address(this));
            uint256 threshold = viaTarget ? 0 : tp.verdictThreshold;
            if (_recordOutflow(token, day, balancesBefore[i], balanceAfter, tp.dailyCap, threshold)) {
                needsVerdict = true;
            }
        }
        uint256 nativeThreshold = viaTarget ? 0 : nativeVerdictThreshold;
        if (_recordOutflow(
                NATIVE, day, balancesBefore[tokenCount], address(this).balance, nativeDailyCap, nativeThreshold
            )) needsVerdict = true;
    }

    function _recordOutflow(
        address token,
        uint256 day,
        uint256 balanceBefore,
        uint256 balanceAfter,
        uint256 cap,
        uint256 threshold
    ) private returns (bool aboveThreshold) {
        if (balanceAfter >= balanceBefore) return false;
        uint256 outflow = balanceBefore - balanceAfter;
        uint256 total = spent[token][day] + outflow;
        if (total > cap) revert DailyCapExceeded(token, total, cap);
        spent[token][day] = total;
        return outflow > threshold;
    }

    function _untrack(address token) private {
        uint256 last = trackedTokens.length - 1;
        for (uint256 i; i <= last; ++i) {
            if (trackedTokens[i] == token) {
                trackedTokens[i] = trackedTokens[last];
                trackedTokens.pop();
                return;
            }
        }
    }

    function _today() private view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
