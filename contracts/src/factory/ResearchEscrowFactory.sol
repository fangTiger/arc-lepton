// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ResearchEscrowEip712} from "../canonical/ResearchEscrowEip712.sol";
import {ResearchEscrow} from "../escrow/ResearchEscrow.sol";

interface IDataSourceRegistryRoleProbe {
    function factory() external view returns (address);
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @notice 负责确定性创建 ResearchEscrow clone。voucher 和资金路径由后续任务补齐。
contract ResearchEscrowFactory is AccessControlEnumerable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroResearchKey();
    error ZeroInitialBudget();
    error ImplementationCodeMissing(address implementation);
    error EscrowAlreadyExists(address buyer, bytes32 researchKey, address escrow);
    error SensitiveRoleConflict(address account, bytes32 existingRole, bytes32 requestedRole);
    error RegistryNotBound(address registry, address actualFactory);
    error InitialDeployerStillPrivileged(address deployer, address authority, bytes32 role);
    error SenderBuyerMismatch(address sender, address buyer);
    error InvalidFundingVoucher();
    error FundingSignatureInvalid();
    error FundingVoucherNonceUsed(address buyer, uint256 nonce);
    error IntentSignerInvalid(address signer);
    error SensitiveAccount(address account, address authority, bytes32 role);
    error UsdcBalanceDeltaMismatch(address buyer, address escrow, uint256 budgetUnits);

    bytes32 public constant FUNDING_SIGNER_ROLE = keccak256("FUNDING_SIGNER_ROLE");
    bytes32 public constant INTENT_SIGNER_ROLE = keccak256("INTENT_SIGNER_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 private constant SOURCE_ADMIN_ROLE = keccak256("SOURCE_ADMIN_ROLE");
    uint64 public constant MIN_ESCROW_TTL = 2 hours;

    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    address private constant ARC_NATIVE_USDC_SYSTEM_EMITTER = address(uint160(type(uint160).max - 1));

    address private immutable IMPLEMENTATION;
    address private immutable REGISTRY;
    address private immutable INITIAL_DEPLOYER;
    mapping(address buyer => mapping(bytes32 researchKey => address escrow)) public escrowOf;
    mapping(address buyer => mapping(uint256 nonce => bool used)) public fundingVoucherNonceUsed;

    event ResearchEscrowCreated(
        address indexed buyer, bytes32 indexed researchKey, address indexed escrow, address implementation
    );
    event ResearchEscrowFunded(
        address indexed buyer,
        bytes32 indexed researchKey,
        address indexed escrow,
        uint256 budgetUnits,
        uint64 expectedExpiresAt,
        uint64 activationCutoff
    );

    constructor(address implementation_, address registry_, address initialAdmin) {
        if (implementation_ == address(0) || registry_ == address(0) || initialAdmin == address(0)) {
            revert ZeroAddress();
        }
        if (implementation_.code.length == 0) {
            revert ImplementationCodeMissing(implementation_);
        }

        IMPLEMENTATION = implementation_;
        REGISTRY = registry_;
        INITIAL_DEPLOYER = initialAdmin;
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }

    function implementation() external view returns (address) {
        return IMPLEMENTATION;
    }

    function registry() external view returns (address) {
        return REGISTRY;
    }

    function initialDeployer() external view returns (address) {
        return INITIAL_DEPLOYER;
    }

    function usdc() external pure returns (address) {
        return ARC_TESTNET_USDC;
    }

    function saltFor(address buyer, bytes32 researchKey) public pure returns (bytes32) {
        if (buyer == address(0)) {
            revert ZeroAddress();
        }
        if (researchKey == bytes32(0)) {
            revert ZeroResearchKey();
        }

        return keccak256(abi.encode(buyer, researchKey));
    }

    function predictEscrow(address buyer, bytes32 researchKey) public view returns (address) {
        return Clones.predictDeterministicAddress(IMPLEMENTATION, saltFor(buyer, researchKey), address(this));
    }

    function pauseCreation() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpauseCreation() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function createAndFund(ResearchEscrowEip712.FundingVoucher calldata voucher, bytes calldata signature)
        external
        nonReentrant
        returns (address)
    {
        uint256 budgetUnits = _consumeFundingVoucher(msg.sender, voucher, signature);
        address escrow = _createEscrow(
            voucher.buyer,
            voucher.researchKey,
            budgetUnits,
            voucher.expectedExpiresAt,
            voucher.fundingDeadline,
            voucher.intentSigner
        );

        IERC20 token = IERC20(ARC_TESTNET_USDC);
        uint256 buyerBefore = token.balanceOf(voucher.buyer);
        uint256 escrowBefore = token.balanceOf(escrow);

        // slither-disable-next-line arbitrary-send-erc20
        token.safeTransferFrom(voucher.buyer, escrow, budgetUnits);

        if (
            buyerBefore - token.balanceOf(voucher.buyer) != budgetUnits
                || token.balanceOf(escrow) - escrowBefore != budgetUnits
        ) {
            revert UsdcBalanceDeltaMismatch(voucher.buyer, escrow, budgetUnits);
        }

        emit ResearchEscrowFunded(
            voucher.buyer, voucher.researchKey, escrow, budgetUnits, voucher.expectedExpiresAt, voucher.fundingDeadline
        );

        return escrow;
    }

    function _createEscrow(
        address buyer,
        bytes32 researchKey,
        uint256 initialBudget,
        uint64 expectedExpiresAt,
        uint64 activationCutoff,
        address plannedIntentSigner
    ) internal whenNotPaused returns (address escrow) {
        if (initialBudget == 0) {
            revert ZeroInitialBudget();
        }

        mapping(bytes32 => address) storage buyerEscrows = escrowOf[buyer];
        address existing = buyerEscrows[researchKey];
        if (existing != address(0)) {
            revert EscrowAlreadyExists(buyer, researchKey, existing);
        }

        bytes32 salt = saltFor(buyer, researchKey);
        escrow = Clones.cloneDeterministic(IMPLEMENTATION, salt);
        buyerEscrows[researchKey] = escrow;
        ResearchEscrow(escrow)
            .initialize(
                address(this),
                REGISTRY,
                ARC_TESTNET_USDC,
                buyer,
                researchKey,
                initialBudget,
                expectedExpiresAt,
                activationCutoff,
                plannedIntentSigner
            );

        emit ResearchEscrowCreated(buyer, researchKey, escrow, IMPLEMENTATION);
    }

    function _consumeFundingVoucher(
        address caller,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes memory signature
    ) internal virtual returns (uint256) {
        _requireFundingGateOpen();
        _requireValidVoucherShape(caller, voucher);

        address fundingSigner = _requireValidFundingSignature(voucher, signature);
        _requireValidIntentSigner(voucher.intentSigner, voucher.buyer, fundingSigner);
        _requireAccountHasNoProjectSensitiveRole(voucher.buyer);

        if (fundingVoucherNonceUsed[voucher.buyer][voucher.voucherNonce]) {
            revert FundingVoucherNonceUsed(voucher.buyer, voucher.voucherNonce);
        }
        fundingVoucherNonceUsed[voucher.buyer][voucher.voucherNonce] = true;

        return voucher.budgetUnits;
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        _requireNoSensitiveRoleConflict(role, account);

        return super._grantRole(role, account);
    }

    function _requireNoSensitiveRoleConflict(bytes32 role, address account) private view {
        if (!_isSensitiveRole(role)) {
            return;
        }

        _requireNoOtherSensitiveRole(role, account, DEFAULT_ADMIN_ROLE);
        _requireNoOtherSensitiveRole(role, account, FUNDING_SIGNER_ROLE);
        _requireNoOtherSensitiveRole(role, account, INTENT_SIGNER_ROLE);
        _requireNoOtherSensitiveRole(role, account, SETTLER_ROLE);

        if (_isBootstrapDefaultAdminGrant(role)) {
            return;
        }

        _requireNoRegistryRoleConflict(role, account, DEFAULT_ADMIN_ROLE);
        _requireNoRegistryRoleConflict(role, account, SOURCE_ADMIN_ROLE);
    }

    function _requireNoOtherSensitiveRole(bytes32 requestedRole, address account, bytes32 existingRole) private view {
        if (requestedRole != existingRole && hasRole(existingRole, account)) {
            revert SensitiveRoleConflict(account, existingRole, requestedRole);
        }
    }

    function _requireNoRegistryRoleConflict(bytes32 requestedRole, address account, bytes32 existingRole) private view {
        if (IDataSourceRegistryRoleProbe(REGISTRY).hasRole(existingRole, account)) {
            revert SensitiveRoleConflict(account, existingRole, requestedRole);
        }
    }

    function _isBootstrapDefaultAdminGrant(bytes32 role) private view returns (bool) {
        return role == DEFAULT_ADMIN_ROLE && address(this).code.length == 0;
    }

    function _isSensitiveRole(bytes32 role) private pure returns (bool) {
        return
            role == DEFAULT_ADMIN_ROLE || role == FUNDING_SIGNER_ROLE || role == INTENT_SIGNER_ROLE
                || role == SETTLER_ROLE;
    }

    function _requireFundingGateOpen() private view {
        address boundFactory = IDataSourceRegistryRoleProbe(REGISTRY).factory();
        if (boundFactory != address(this)) {
            revert RegistryNotBound(REGISTRY, boundFactory);
        }

        _requireInitialDeployerHasNoFactoryRole(DEFAULT_ADMIN_ROLE);
        _requireInitialDeployerHasNoFactoryRole(FUNDING_SIGNER_ROLE);
        _requireInitialDeployerHasNoFactoryRole(INTENT_SIGNER_ROLE);
        _requireInitialDeployerHasNoFactoryRole(SETTLER_ROLE);
        _requireInitialDeployerHasNoRegistryRole(DEFAULT_ADMIN_ROLE);
        _requireInitialDeployerHasNoRegistryRole(SOURCE_ADMIN_ROLE);
    }

    function _requireInitialDeployerHasNoFactoryRole(bytes32 role) private view {
        if (hasRole(role, INITIAL_DEPLOYER)) {
            revert InitialDeployerStillPrivileged(INITIAL_DEPLOYER, address(this), role);
        }
    }

    function _requireInitialDeployerHasNoRegistryRole(bytes32 role) private view {
        if (IDataSourceRegistryRoleProbe(REGISTRY).hasRole(role, INITIAL_DEPLOYER)) {
            revert InitialDeployerStillPrivileged(INITIAL_DEPLOYER, REGISTRY, role);
        }
    }

    function _requireValidVoucherShape(address caller, ResearchEscrowEip712.FundingVoucher memory voucher)
        private
        view
    {
        if (caller != voucher.buyer) {
            revert SenderBuyerMismatch(caller, voucher.buyer);
        }
        if (
            voucher.buyer == address(0) || voucher.researchKey == bytes32(0) || voucher.budgetUnits == 0
                || voucher.intentSigner == address(0)
        ) {
            revert InvalidFundingVoucher();
        }
        if (!ResearchEscrowEip712.isDeadlineLive(block.timestamp, voucher.fundingDeadline)) {
            revert InvalidFundingVoucher();
        }
        if (voucher.expectedExpiresAt < block.timestamp + MIN_ESCROW_TTL) {
            revert InvalidFundingVoucher();
        }
        if (voucher.expectedExpiresAt <= voucher.fundingDeadline) {
            revert InvalidFundingVoucher();
        }
    }

    function _requireValidFundingSignature(ResearchEscrowEip712.FundingVoucher memory voucher, bytes memory signature)
        private
        view
        returns (address fundingSigner)
    {
        bytes32 digest = ResearchEscrowEip712.fundingVoucherDigest(block.chainid, address(this), voucher);
        uint256 signerCount = getRoleMemberCount(FUNDING_SIGNER_ROLE);

        for (uint256 i = 0; i < signerCount; ++i) {
            address candidate = getRoleMember(FUNDING_SIGNER_ROLE, i);
            if (ResearchEscrowEip712.isValidFlexibleSignature(candidate, digest, signature)) {
                return candidate;
            }
        }

        revert FundingSignatureInvalid();
    }

    function _requireValidIntentSigner(address intentSigner, address buyer, address fundingSigner) private view {
        if (
            intentSigner == address(0) || intentSigner.code.length != 0 || intentSigner == buyer
                || intentSigner == fundingSigner || _isProtocolAddress(intentSigner)
        ) {
            revert IntentSignerInvalid(intentSigner);
        }
        if (!hasRole(INTENT_SIGNER_ROLE, intentSigner)) {
            revert IntentSignerInvalid(intentSigner);
        }

        _requireNoFactorySensitiveRole(intentSigner, DEFAULT_ADMIN_ROLE);
        _requireNoFactorySensitiveRole(intentSigner, FUNDING_SIGNER_ROLE);
        _requireNoFactorySensitiveRole(intentSigner, SETTLER_ROLE);
        _requireNoRegistrySensitiveRole(intentSigner, DEFAULT_ADMIN_ROLE);
        _requireNoRegistrySensitiveRole(intentSigner, SOURCE_ADMIN_ROLE);
    }

    function _requireAccountHasNoProjectSensitiveRole(address account) private view {
        _requireNoFactorySensitiveRole(account, DEFAULT_ADMIN_ROLE);
        _requireNoFactorySensitiveRole(account, FUNDING_SIGNER_ROLE);
        _requireNoFactorySensitiveRole(account, INTENT_SIGNER_ROLE);
        _requireNoFactorySensitiveRole(account, SETTLER_ROLE);
        _requireNoRegistrySensitiveRole(account, DEFAULT_ADMIN_ROLE);
        _requireNoRegistrySensitiveRole(account, SOURCE_ADMIN_ROLE);
    }

    function _requireNoFactorySensitiveRole(address account, bytes32 role) private view {
        if (hasRole(role, account)) {
            revert SensitiveAccount(account, address(this), role);
        }
    }

    function _requireNoRegistrySensitiveRole(address account, bytes32 role) private view {
        if (IDataSourceRegistryRoleProbe(REGISTRY).hasRole(role, account)) {
            revert SensitiveAccount(account, REGISTRY, role);
        }
    }

    function _isProtocolAddress(address account) private view returns (bool) {
        return account == address(this) || account == IMPLEMENTATION || account == REGISTRY
            || account == ARC_TESTNET_USDC || account == ARC_NATIVE_USDC_SYSTEM_EMITTER;
    }
}
