// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {CanonicalResearch} from "../canonical/CanonicalResearch.sol";
import {ResearchEscrowEip712} from "../canonical/ResearchEscrowEip712.sol";

interface IProjectRoleProbe {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

interface IProjectPauseProbe {
    function paused() external view returns (bool);
}

interface IDataSourceRegistrySnapshot {
    function getSource(bytes32 sourceId)
        external
        view
        returns (uint64 revision, address payout, uint256 maxUnitPrice, bool active);
}

/// @notice 每个 research 的最小资金隔离 clone，负责资助后激活、结算、关闭、退款与 excess recovery。
contract ResearchEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error AlreadyInitialized();
    error ZeroAddress();
    error ZeroResearchKey();
    error ZeroInitialBudget();
    error InvalidFundingWindow();
    error InvalidState(EscrowState expected, EscrowState actual);
    error InvalidActivationAuthorization();
    error InvalidActivationSignature();
    error ActivationPaused();
    error ActivationNonceUsed(uint256 nonce);
    error InvalidIntentSigner(address signer);
    error SensitiveRoleConflict(address account, address authority, bytes32 role);
    error ActivationAccountingNotClean();
    error UnauthorizedCancel(address caller);
    error EmptySettlementBatch();
    error SettlementBatchTooLarge(uint256 itemCount, uint256 maxItemCount);
    error InvalidSettlementAuthorization();
    error InvalidSettlementSignature();
    error InvalidSettlementAuthorizationWindow();
    error UnauthorizedSettler(address caller);
    error InvalidSettlementSigner(address signer);
    error SettlementBudgetExceeded(uint256 spent, uint256 total, uint256 budget);
    error RegistrySnapshotMismatch(bytes32 sourceId);
    error RegistrySourceInactive(bytes32 sourceId);
    error SettlementItemAmountExceedsMax(bytes32 sourceId, uint256 amount, uint256 maxUnitPrice);
    error SensitivePayout(address payout);
    error SettlementBalanceDeltaMismatch(address payout, uint256 amount);
    error InvalidCloseAuthorization();
    error InvalidCloseAuthorizationWindow();
    error InvalidCloseSignature();
    error InvalidCloseSigner(address signer);
    error CloseNonceUsed(uint256 nonce);
    error EscrowNotExpired(uint256 currentTime, uint64 expectedExpiresAt);
    error PaidLiabilityNotSettled(bytes32 requestKey);
    error PaidLiabilityResultMismatch(bytes32 settlementKey);
    error NoRecoverableExcess();
    error EscrowBalanceBelowAccounted(uint256 actualBalance, uint256 accountedBalance);

    bytes32 private constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 private constant SOURCE_ADMIN_ROLE = keccak256("SOURCE_ADMIN_ROLE");
    bytes32 private constant FUNDING_SIGNER_ROLE = keccak256("FUNDING_SIGNER_ROLE");
    bytes32 private constant INTENT_SIGNER_ROLE = keccak256("INTENT_SIGNER_ROLE");
    bytes32 private constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    uint256 public constant MAX_BATCH_SIZE = 32;
    uint64 private constant MAX_AUTHORIZATION_LIFETIME = 5 minutes;
    address private constant ARC_NATIVE_USDC_SYSTEM_EMITTER = address(uint160(type(uint160).max - 1));

    enum EscrowState {
        Uninitialized,
        Funded,
        Active,
        Closed
    }

    bool private _initialized;

    address public factory;
    address public registry;
    address public usdc;
    address public buyer;
    bytes32 public researchKey;
    uint256 public initialBudget;
    uint64 public expectedExpiresAt;
    uint64 public activationCutoff;
    address public plannedIntentSigner;
    address public activeIntentSigner;
    uint256 public spent;
    EscrowState public state;
    mapping(uint256 nonce => bool used) public activationNonceUsed;
    mapping(uint256 nonce => bool used) public closeNonceUsed;
    mapping(bytes32 requestKey => bool processed) public processedRequestKey;
    mapping(bytes32 settlementKey => bool processed) public processedSettlementKey;
    mapping(bytes32 settlementKey => SettlementResult result) private _settlementResults;
    uint8 public closeReason;
    bytes32 public finalLiabilityHash;
    uint256 public budgetRefund;
    uint256 public excessRefund;

    struct SettlementResult {
        bytes32 itemsHash;
        uint256 total;
        uint32 itemCount;
    }

    event ResearchEscrowActivated(
        address indexed buyer,
        bytes32 indexed researchKey,
        address indexed intentSigner,
        uint256 activationNonce,
        uint64 deadline
    );
    event ResearchEscrowUnactivatedCancelled(address indexed buyer, bytes32 indexed researchKey, uint256 refund);
    event ResearchEscrowSettled(
        bytes32 indexed settlementKey, bytes32 indexed itemsHash, uint256 total, uint32 itemCount
    );
    event ResearchEscrowSettlementItem(
        bytes32 indexed settlementKey,
        bytes32 indexed requestKey,
        bytes32 indexed sourceId,
        address payout,
        uint256 amount
    );
    event ResearchEscrowClosed(
        address indexed buyer,
        bytes32 indexed researchKey,
        bytes32 indexed finalLiabilityHash,
        uint8 closeReason,
        uint256 spent,
        uint256 budgetRefund,
        uint256 excessRefund
    );
    event ResearchEscrowExpiredRefunded(
        address indexed buyer, bytes32 indexed researchKey, uint256 budgetRefund, uint256 excessRefund
    );
    event ResearchEscrowExcessRecovered(address indexed buyer, bytes32 indexed researchKey, uint256 amount);

    constructor() {
        _initialized = true;
    }

    function initialize(
        address factory_,
        address registry_,
        address usdc_,
        address buyer_,
        bytes32 researchKey_,
        uint256 initialBudget_,
        uint64 expectedExpiresAt_,
        uint64 activationCutoff_,
        address plannedIntentSigner_
    ) external {
        if (_initialized) {
            revert AlreadyInitialized();
        }
        if (
            factory_ == address(0) || registry_ == address(0) || usdc_ == address(0) || buyer_ == address(0)
                || plannedIntentSigner_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (researchKey_ == bytes32(0)) {
            revert ZeroResearchKey();
        }
        if (initialBudget_ == 0) {
            revert ZeroInitialBudget();
        }
        if (activationCutoff_ == 0 || expectedExpiresAt_ <= activationCutoff_) {
            revert InvalidFundingWindow();
        }

        _initialized = true;
        factory = factory_;
        registry = registry_;
        usdc = usdc_;
        buyer = buyer_;
        researchKey = researchKey_;
        initialBudget = initialBudget_;
        expectedExpiresAt = expectedExpiresAt_;
        activationCutoff = activationCutoff_;
        plannedIntentSigner = plannedIntentSigner_;
        state = EscrowState.Funded;
    }

    function accountedBalance() public view returns (uint256) {
        return initialBudget - spent;
    }

    function excessBalance() public view returns (uint256) {
        uint256 actualBalance = IERC20(usdc).balanceOf(address(this));
        uint256 accounted = state == EscrowState.Closed ? 0 : accountedBalance();
        if (actualBalance <= accounted) {
            return 0;
        }

        return actualBalance - accounted;
    }

    function activate(ResearchEscrowEip712.ActivationAuthorization calldata authorization, bytes calldata signature)
        external
        nonReentrant
    {
        if (state != EscrowState.Funded) {
            revert InvalidState(EscrowState.Funded, state);
        }
        if (IProjectPauseProbe(factory).paused()) {
            revert ActivationPaused();
        }
        _requireMatchingActivationAuthorization(authorization);
        if (activationNonceUsed[authorization.activationNonce]) {
            revert ActivationNonceUsed(authorization.activationNonce);
        }
        if (
            !ResearchEscrowEip712.isDeadlineLive(block.timestamp, authorization.deadline)
                || authorization.deadline > activationCutoff || block.timestamp > activationCutoff
        ) {
            revert InvalidActivationAuthorization();
        }
        _requireCleanActivationAccounting();
        _requireValidIntentSigner(authorization.intentSigner);

        bytes32 digest = ResearchEscrowEip712.activationAuthorizationDigest(block.chainid, address(this), authorization);
        if (!ResearchEscrowEip712.isValidFlexibleSignature(buyer, digest, signature)) {
            revert InvalidActivationSignature();
        }

        activationNonceUsed[authorization.activationNonce] = true;
        activeIntentSigner = authorization.intentSigner;
        state = EscrowState.Active;

        emit ResearchEscrowActivated(
            buyer, researchKey, authorization.intentSigner, authorization.activationNonce, authorization.deadline
        );
    }

    function cancelUnactivated() external nonReentrant {
        if (msg.sender != buyer) {
            revert UnauthorizedCancel(msg.sender);
        }
        if (state != EscrowState.Funded) {
            revert InvalidState(EscrowState.Funded, state);
        }

        state = EscrowState.Closed;

        uint256 refund = IERC20(usdc).balanceOf(address(this));
        budgetRefund = refund;
        if (refund != 0) {
            IERC20(usdc).safeTransfer(buyer, refund);
        }

        emit ResearchEscrowUnactivatedCancelled(buyer, researchKey, refund);
    }

    function close(
        CanonicalResearch.LiabilityItem[] calldata liabilities,
        bytes32[] calldata expectedRequestKeys,
        ResearchEscrowEip712.CloseAuthorization calldata authorization,
        bytes calldata signature
    ) external nonReentrant {
        if (closeNonceUsed[authorization.nonce]) {
            revert CloseNonceUsed(authorization.nonce);
        }
        if (state != EscrowState.Active) {
            revert InvalidState(EscrowState.Active, state);
        }
        if (!IProjectRoleProbe(factory).hasRole(SETTLER_ROLE, msg.sender)) {
            revert UnauthorizedSettler(msg.sender);
        }

        _requireMatchingCloseAuthorization(authorization);
        _requireCloseAuthorizationWindow(authorization);
        _requirePaidLiabilitiesSettled(liabilities);

        if (authorization.spent != spent) {
            revert InvalidCloseAuthorization();
        }

        bytes32 computedFinalLiabilityHash =
            CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, spent);
        if (computedFinalLiabilityHash != authorization.finalLiabilityHash) {
            revert InvalidCloseAuthorization();
        }

        _requireValidCloseSigner(activeIntentSigner);

        bytes32 digest = ResearchEscrowEip712.closeAuthorizationDigest(block.chainid, address(this), authorization);
        if (!ResearchEscrowEip712.isValidStrictEoaSignature(activeIntentSigner, digest, signature)) {
            revert InvalidCloseSignature();
        }

        closeNonceUsed[authorization.nonce] = true;
        closeReason = authorization.closeReason;
        finalLiabilityHash = authorization.finalLiabilityHash;
        state = EscrowState.Closed;

        (uint256 recordedBudgetRefund, uint256 recordedExcessRefund, uint256 actualBalance) =
            _recordRefundsForCurrentBalance();
        emit ResearchEscrowClosed(
            buyer,
            researchKey,
            authorization.finalLiabilityHash,
            authorization.closeReason,
            spent,
            recordedBudgetRefund,
            recordedExcessRefund
        );
        _transferRecordedBalance(actualBalance);
    }

    function refundExpired() external nonReentrant {
        if (block.timestamp < expectedExpiresAt) {
            revert EscrowNotExpired(block.timestamp, expectedExpiresAt);
        }
        if (state == EscrowState.Closed) {
            revert InvalidState(EscrowState.Active, state);
        }

        state = EscrowState.Closed;
        (uint256 recordedBudgetRefund, uint256 recordedExcessRefund, uint256 actualBalance) =
            _recordRefundsForCurrentBalance();
        emit ResearchEscrowExpiredRefunded(buyer, researchKey, recordedBudgetRefund, recordedExcessRefund);
        _transferRecordedBalance(actualBalance);
    }

    function recoverExcess() external nonReentrant {
        if (state != EscrowState.Closed) {
            revert InvalidState(EscrowState.Closed, state);
        }

        IERC20 token = IERC20(usdc);
        uint256 recoverable = token.balanceOf(address(this));
        if (recoverable < 1) {
            revert NoRecoverableExcess();
        }

        emit ResearchEscrowExcessRecovered(buyer, researchKey, recoverable);
        token.safeTransfer(buyer, recoverable);
    }

    function settleBatch(
        bytes32 settlementKey,
        CanonicalResearch.SettlementItem[] calldata items,
        ResearchEscrowEip712.SettlementAuthorization calldata authorization,
        bytes calldata signature
    ) external nonReentrant {
        if (state != EscrowState.Active) {
            revert InvalidState(EscrowState.Active, state);
        }
        if (!IProjectRoleProbe(factory).hasRole(SETTLER_ROLE, msg.sender)) {
            revert UnauthorizedSettler(msg.sender);
        }
        if (settlementKey == bytes32(0)) {
            revert CanonicalResearch.ZeroKey();
        }
        if (items.length == 0) {
            revert EmptySettlementBatch();
        }
        if (items.length > MAX_BATCH_SIZE) {
            revert SettlementBatchTooLarge(items.length, MAX_BATCH_SIZE);
        }

        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        uint256 total = _validateSettlementItems(items);
        uint32 itemCount = uint32(items.length);

        _requireMatchingSettlementAuthorization(authorization, settlementKey, itemsHash, total, itemCount);
        _requireSettlementAuthorizationWindow(authorization);
        _requireValidSettlementSigner(activeIntentSigner);

        bytes32 digest = ResearchEscrowEip712.settlementAuthorizationDigest(block.chainid, address(this), authorization);
        if (!ResearchEscrowEip712.isValidStrictEoaSignature(activeIntentSigner, digest, signature)) {
            revert InvalidSettlementSignature();
        }
        if (spent + total > initialBudget) {
            revert SettlementBudgetExceeded(spent, total, initialBudget);
        }
        if (processedSettlementKey[settlementKey]) {
            revert InvalidSettlementAuthorization();
        }

        spent += total;
        processedSettlementKey[settlementKey] = true;
        _settlementResults[settlementKey] = SettlementResult({itemsHash: itemsHash, total: total, itemCount: itemCount});

        emit ResearchEscrowSettled(settlementKey, itemsHash, total, itemCount);

        IERC20 token = IERC20(usdc);
        for (uint256 index = 0; index < items.length; ++index) {
            CanonicalResearch.SettlementItem calldata item = items[index];
            if (processedRequestKey[item.requestKey]) {
                revert InvalidSettlementAuthorization();
            }
            processedRequestKey[item.requestKey] = true;

            emit ResearchEscrowSettlementItem(
                settlementKey, item.requestKey, item.sourceId, item.expectedPayout, item.amount
            );

            uint256 escrowBefore = token.balanceOf(address(this));
            uint256 payoutBefore = token.balanceOf(item.expectedPayout);
            token.safeTransfer(item.expectedPayout, item.amount);
            if (
                escrowBefore - token.balanceOf(address(this)) != item.amount
                    || token.balanceOf(item.expectedPayout) - payoutBefore != item.amount
            ) {
                revert SettlementBalanceDeltaMismatch(item.expectedPayout, item.amount);
            }
        }
    }

    function settlementResult(bytes32 settlementKey)
        external
        view
        returns (bytes32 itemsHash, uint256 total, uint32 itemCount)
    {
        SettlementResult memory result = _settlementResults[settlementKey];
        return (result.itemsHash, result.total, result.itemCount);
    }

    function _requireMatchingActivationAuthorization(
        ResearchEscrowEip712.ActivationAuthorization calldata authorization
    ) private view {
        if (
            authorization.escrow != address(this) || authorization.researchKey != researchKey
                || authorization.buyer != buyer || authorization.intentSigner != plannedIntentSigner
                || authorization.initialBudget != initialBudget || authorization.expectedExpiresAt != expectedExpiresAt
        ) {
            revert InvalidActivationAuthorization();
        }
    }

    function _requireCleanActivationAccounting() private view {
        if (spent != 0 || accountedBalance() != initialBudget) {
            revert ActivationAccountingNotClean();
        }
        if (IERC20(usdc).balanceOf(address(this)) < initialBudget) {
            revert ActivationAccountingNotClean();
        }
    }

    function _requireValidIntentSigner(address intentSigner) private view {
        if (
            intentSigner == address(0) || intentSigner.code.length != 0 || intentSigner == buyer
                || _isProtocolAddress(intentSigner)
        ) {
            revert InvalidIntentSigner(intentSigner);
        }
        if (!IProjectRoleProbe(factory).hasRole(INTENT_SIGNER_ROLE, intentSigner)) {
            revert InvalidIntentSigner(intentSigner);
        }

        _requireNoRole(factory, intentSigner, DEFAULT_ADMIN_ROLE);
        _requireNoRole(factory, intentSigner, FUNDING_SIGNER_ROLE);
        _requireNoRole(factory, intentSigner, SETTLER_ROLE);
        _requireNoRole(registry, intentSigner, DEFAULT_ADMIN_ROLE);
        _requireNoRole(registry, intentSigner, SOURCE_ADMIN_ROLE);
    }

    function _validateSettlementItems(CanonicalResearch.SettlementItem[] calldata items)
        private
        view
        returns (uint256 total)
    {
        for (uint256 index = 0; index < items.length; ++index) {
            CanonicalResearch.SettlementItem calldata item = items[index];
            (uint64 revision, address payout, uint256 maxUnitPrice, bool active) =
                IDataSourceRegistrySnapshot(registry).getSource(item.sourceId);
            if (!active) {
                revert RegistrySourceInactive(item.sourceId);
            }
            if (revision != item.registryRevision || payout != item.expectedPayout || maxUnitPrice != item.maxUnitPrice)
            {
                revert RegistrySnapshotMismatch(item.sourceId);
            }
            if (item.amount == 0 || item.amount > maxUnitPrice) {
                revert SettlementItemAmountExceedsMax(item.sourceId, item.amount, maxUnitPrice);
            }
            _requireSafePayout(item.expectedPayout);
            total += item.amount;
        }
    }

    function _requireMatchingSettlementAuthorization(
        ResearchEscrowEip712.SettlementAuthorization calldata authorization,
        bytes32 settlementKey,
        bytes32 itemsHash,
        uint256 total,
        uint32 itemCount
    ) private view {
        if (
            authorization.escrow != address(this) || authorization.researchKey != researchKey
                || authorization.settlementKey != settlementKey || authorization.itemsHash != itemsHash
                || authorization.total != total || authorization.itemCount != itemCount
        ) {
            revert InvalidSettlementAuthorization();
        }
    }

    function _requireMatchingCloseAuthorization(ResearchEscrowEip712.CloseAuthorization calldata authorization)
        private
        view
    {
        if (
            authorization.escrow != address(this) || authorization.researchKey != researchKey
                || authorization.finalLiabilityHash == bytes32(0)
        ) {
            revert InvalidCloseAuthorization();
        }
    }

    function _requireSettlementAuthorizationWindow(ResearchEscrowEip712.SettlementAuthorization calldata authorization)
        private
        view
    {
        if (!ResearchEscrowEip712.isAuthorizationWindowLive(
                authorization.issuedAt,
                authorization.deadline,
                block.timestamp,
                MAX_AUTHORIZATION_LIFETIME,
                expectedExpiresAt
            )) {
            revert InvalidSettlementAuthorizationWindow();
        }
    }

    function _requireCloseAuthorizationWindow(ResearchEscrowEip712.CloseAuthorization calldata authorization)
        private
        view
    {
        if (!ResearchEscrowEip712.isAuthorizationWindowLive(
                authorization.issuedAt,
                authorization.deadline,
                block.timestamp,
                MAX_AUTHORIZATION_LIFETIME,
                expectedExpiresAt
            )) {
            revert InvalidCloseAuthorizationWindow();
        }
    }

    function _requireValidSettlementSigner(address intentSigner) private view {
        if (
            intentSigner == address(0) || intentSigner.code.length != 0 || intentSigner == buyer
                || intentSigner == msg.sender || _isProtocolAddress(intentSigner)
        ) {
            revert InvalidSettlementSigner(intentSigner);
        }

        _requireNoRole(factory, intentSigner, DEFAULT_ADMIN_ROLE);
        _requireNoRole(factory, intentSigner, FUNDING_SIGNER_ROLE);
        _requireNoRole(factory, intentSigner, SETTLER_ROLE);
        _requireNoRole(registry, intentSigner, DEFAULT_ADMIN_ROLE);
        _requireNoRole(registry, intentSigner, SOURCE_ADMIN_ROLE);

        if (!IProjectRoleProbe(factory).hasRole(INTENT_SIGNER_ROLE, intentSigner)) {
            revert InvalidSettlementSigner(intentSigner);
        }
    }

    function _requireValidCloseSigner(address intentSigner) private view {
        if (
            intentSigner == address(0) || intentSigner.code.length != 0 || intentSigner == buyer
                || intentSigner == msg.sender || _isProtocolAddress(intentSigner)
        ) {
            revert InvalidCloseSigner(intentSigner);
        }

        if (
            IProjectRoleProbe(factory).hasRole(DEFAULT_ADMIN_ROLE, intentSigner)
                || IProjectRoleProbe(factory).hasRole(FUNDING_SIGNER_ROLE, intentSigner)
                || IProjectRoleProbe(factory).hasRole(SETTLER_ROLE, intentSigner)
                || IProjectRoleProbe(registry).hasRole(DEFAULT_ADMIN_ROLE, intentSigner)
                || IProjectRoleProbe(registry).hasRole(SOURCE_ADMIN_ROLE, intentSigner)
        ) {
            revert InvalidCloseSigner(intentSigner);
        }

        if (!IProjectRoleProbe(factory).hasRole(INTENT_SIGNER_ROLE, intentSigner)) {
            revert InvalidCloseSigner(intentSigner);
        }
    }

    function _requirePaidLiabilitiesSettled(CanonicalResearch.LiabilityItem[] calldata liabilities) private view {
        for (uint256 index = 0; index < liabilities.length; ++index) {
            CanonicalResearch.LiabilityItem calldata liability = liabilities[index];
            if (liability.terminalState != 1) {
                continue;
            }
            if (
                !processedRequestKey[liability.requestKey] || !processedSettlementKey[liability.settlementKey]
                    || liability.settlementKey == bytes32(0)
            ) {
                revert PaidLiabilityNotSettled(liability.requestKey);
            }

            SettlementResult memory result = _settlementResults[liability.settlementKey];
            bytes32 expectedResultDigest = CanonicalResearch.settlementResultDigest(
                liability.settlementKey, result.itemsHash, result.total, result.itemCount
            );
            if (liability.terminalEvidenceHash != expectedResultDigest) {
                revert PaidLiabilityResultMismatch(liability.settlementKey);
            }
        }
    }

    function _recordRefundsForCurrentBalance()
        private
        returns (uint256 recordedBudgetRefund, uint256 recordedExcessRefund, uint256 actualBalance)
    {
        IERC20 token = IERC20(usdc);
        actualBalance = token.balanceOf(address(this));
        uint256 remainingBudget = accountedBalance();
        if (actualBalance < remainingBudget) {
            revert EscrowBalanceBelowAccounted(actualBalance, remainingBudget);
        }

        recordedBudgetRefund = remainingBudget;
        recordedExcessRefund = actualBalance - remainingBudget;
        budgetRefund = recordedBudgetRefund;
        excessRefund = recordedExcessRefund;
    }

    function _transferRecordedBalance(uint256 actualBalance) private {
        if (actualBalance != 0) {
            IERC20(usdc).safeTransfer(buyer, actualBalance);
        }
    }

    function _requireSafePayout(address payout) private view {
        if (payout == address(0) || payout == buyer || _isProtocolAddress(payout)) {
            revert SensitivePayout(payout);
        }
        if (
            IProjectRoleProbe(factory).hasRole(DEFAULT_ADMIN_ROLE, payout)
                || IProjectRoleProbe(factory).hasRole(FUNDING_SIGNER_ROLE, payout)
                || IProjectRoleProbe(factory).hasRole(INTENT_SIGNER_ROLE, payout)
                || IProjectRoleProbe(factory).hasRole(SETTLER_ROLE, payout)
                || IProjectRoleProbe(registry).hasRole(DEFAULT_ADMIN_ROLE, payout)
                || IProjectRoleProbe(registry).hasRole(SOURCE_ADMIN_ROLE, payout)
        ) {
            revert SensitivePayout(payout);
        }
    }

    function _requireNoRole(address authority, address account, bytes32 role) private view {
        if (IProjectRoleProbe(authority).hasRole(role, account)) {
            revert SensitiveRoleConflict(account, authority, role);
        }
    }

    function _isProtocolAddress(address account) private view returns (bool) {
        return account == address(this) || account == factory || account == registry || account == usdc
            || account == ARC_NATIVE_USDC_SYSTEM_EMITTER;
    }
}
