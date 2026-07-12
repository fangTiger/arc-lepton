// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {CanonicalResearch} from "../../../src/canonical/CanonicalResearch.sol";
import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";
import {IProjectRoleProbe, ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {FalseReturnToken} from "../../fixtures/tokens/FalseReturnToken.sol";
import {FeeOnTransferToken} from "../../fixtures/tokens/FeeOnTransferToken.sol";
import {MockUSDC} from "../../fixtures/tokens/MockUSDC.sol";
import {ReentrantToken} from "../../fixtures/tokens/ReentrantToken.sol";
import {RevertingToken, RevertingTokenTransferBlocked} from "../../fixtures/tokens/RevertingToken.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface SettlementVm {
    struct RecordedLog {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function expectPartialRevert(bytes4 revertData) external;
    function getRecordedLogs() external returns (RecordedLog[] memory);
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
    function prank(address sender) external;
    function recordLogs() external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

interface IResearchEscrowSettlement {
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

    function activate(ResearchEscrowEip712.ActivationAuthorization calldata authorization, bytes calldata signature)
        external;

    function settleBatch(
        bytes32 settlementKey,
        CanonicalResearch.SettlementItem[] calldata items,
        ResearchEscrowEip712.SettlementAuthorization calldata authorization,
        bytes calldata signature
    ) external;

    function spent() external view returns (uint256);
    function accountedBalance() external view returns (uint256);
    function processedRequestKey(bytes32 requestKey) external view returns (bool);
    function processedSettlementKey(bytes32 settlementKey) external view returns (bool);
    function settlementResult(bytes32 settlementKey)
        external
        view
        returns (bytes32 itemsHash, uint256 total, uint32 itemCount);
}

contract ResearchEscrowSettlementTest is RoleIsolationFixture {
    SettlementVm private constant VM = SettlementVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant REQUEST_KEY_1 = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 private constant REQUEST_KEY_2 = 0x2222222222222222222222222222222222222222222222222222222222222222;
    bytes32 private constant SETTLEMENT_KEY = 0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7;
    bytes32 private constant SETTLEMENT_KEY_TWO = 0x3333333333333333333333333333333333333333333333333333333333333333;
    bytes32 private constant SOURCE_ID_1 = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;
    bytes32 private constant SOURCE_ID_2 = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee;
    uint256 private constant BUDGET_UNITS = 1_000_000;
    uint256 private constant MAX_BATCH_SIZE = 32;
    uint256 private constant FIRST_AMOUNT = 100;
    uint256 private constant SECOND_AMOUNT = 250;
    uint256 private constant TOTAL_AMOUNT = FIRST_AMOUNT + SECOND_AMOUNT;
    uint64 private constant NOW_TS = 1_999_960_000;
    uint64 private constant FUNDING_DEADLINE = NOW_TS + 15 minutes;
    uint256 private constant BUYER_KEY = 0xB001;
    uint256 private constant FUNDING_SIGNER_KEY = 0xF001;
    uint256 private constant INTENT_SIGNER_KEY = 0x1A01;
    uint256 private constant WRONG_SIGNER_KEY = 0xBAD1;
    address private constant PAYOUT_TWO = address(0xCA58);
    address private constant PAYOUT_THREE = address(0xCA59);
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

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

    struct FactoryDeployment {
        ResearchEscrow implementation;
        DataSourceRegistry registry;
        ResearchEscrowFactory factory;
        MockUSDC usdc;
    }

    function testValidSettleBatchPaysMultipleSourcesAndRecordsSummary() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization =
            _validSettlementAuthorization(escrow, voucher, itemsHash, 1);
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        uint256 escrowBefore = deployment.usdc.balanceOf(escrow);
        uint256 payoutOneBefore = deployment.usdc.balanceOf(PAYOUT);
        uint256 payoutTwoBefore = deployment.usdc.balanceOf(PAYOUT_TWO);

        VM.expectEmit(true, true, false, true, escrow);
        emit ResearchEscrowSettled(SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2);
        VM.expectEmit(true, true, true, true, escrow);
        emit ResearchEscrowSettlementItem(SETTLEMENT_KEY, REQUEST_KEY_1, SOURCE_ID_1, PAYOUT, FIRST_AMOUNT);
        VM.expectEmit(true, true, true, true, escrow);
        emit ResearchEscrowSettlementItem(SETTLEMENT_KEY, REQUEST_KEY_2, SOURCE_ID_2, PAYOUT_TWO, SECOND_AMOUNT);

        VM.prank(SETTLER);
        IResearchEscrowSettlement(escrow).settleBatch(SETTLEMENT_KEY, items, authorization, signature);

        assert(IResearchEscrowSettlement(escrow).spent() == TOTAL_AMOUNT);
        assert(IResearchEscrowSettlement(escrow).accountedBalance() == BUDGET_UNITS - TOTAL_AMOUNT);
        assert(deployment.usdc.balanceOf(escrow) == escrowBefore - TOTAL_AMOUNT);
        assert(deployment.usdc.balanceOf(PAYOUT) == payoutOneBefore + FIRST_AMOUNT);
        assert(deployment.usdc.balanceOf(PAYOUT_TWO) == payoutTwoBefore + SECOND_AMOUNT);
        assert(IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));
        assert(IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_2));

        (bytes32 recordedItemsHash, uint256 recordedTotal, uint32 recordedItemCount) =
            IResearchEscrowSettlement(escrow).settlementResult(SETTLEMENT_KEY);
        assert(recordedItemsHash == itemsHash);
        assert(recordedTotal == TOTAL_AMOUNT);
        assert(recordedItemCount == 2);
    }

    function testRejectsEmptySettlementBatch() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.SettlementItem[] memory emptyItems = new CanonicalResearch.SettlementItem[](0);
        ResearchEscrowEip712.SettlementAuthorization memory emptyAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, keccak256("empty-items"), 0, 0, 11, NOW_TS, NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            emptyItems,
            emptyAuthorization,
            _signSettlementAuthorization(escrow, emptyAuthorization),
            IResearchEscrowSettlement.EmptySettlementBatch.selector
        );
    }

    function testRejectsOversizedSettlementBatch() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.SettlementItem[] memory oversizedItems = _sequentialItems(MAX_BATCH_SIZE + 1, 1);
        bytes32 oversizedHash = CanonicalResearch.itemsHash(oversizedItems);
        ResearchEscrowEip712.SettlementAuthorization memory oversizedAuthorization = _settlementAuthorization(
            escrow,
            voucher,
            SETTLEMENT_KEY,
            oversizedHash,
            oversizedItems.length,
            uint32(oversizedItems.length),
            12,
            NOW_TS,
            NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            oversizedItems,
            oversizedAuthorization,
            _signSettlementAuthorization(escrow, oversizedAuthorization),
            IResearchEscrowSettlement.SettlementBatchTooLarge.selector
        );
    }

    function testRejectsUnsortedSettlementItems() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.SettlementItem[] memory unsortedItems = _validItems();
        unsortedItems[0].requestKey = REQUEST_KEY_2;
        unsortedItems[1].requestKey = REQUEST_KEY_1;
        ResearchEscrowEip712.SettlementAuthorization memory unsortedAuthorization = _settlementAuthorization(
            escrow,
            voucher,
            SETTLEMENT_KEY,
            keccak256("unsorted-items"),
            TOTAL_AMOUNT,
            2,
            13,
            NOW_TS,
            NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            unsortedItems,
            unsortedAuthorization,
            _signSettlementAuthorization(escrow, unsortedAuthorization),
            CanonicalResearch.UnsortedKeys.selector
        );
    }

    function testRejectsDuplicateSettlementRequestKeys() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.SettlementItem[] memory duplicateItems = _validItems();
        duplicateItems[1].requestKey = REQUEST_KEY_1;
        ResearchEscrowEip712.SettlementAuthorization memory duplicateAuthorization = _settlementAuthorization(
            escrow,
            voucher,
            SETTLEMENT_KEY,
            keccak256("duplicate-items"),
            TOTAL_AMOUNT,
            2,
            14,
            NOW_TS,
            NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            duplicateItems,
            duplicateAuthorization,
            _signSettlementAuthorization(escrow, duplicateAuthorization),
            CanonicalResearch.UnsortedKeys.selector
        );
    }

    function testRejectsZeroSettlementRequestKey() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.SettlementItem[] memory zeroKeyItems = _validItems();
        zeroKeyItems[0].requestKey = bytes32(0);
        ResearchEscrowEip712.SettlementAuthorization memory zeroKeyAuthorization = _settlementAuthorization(
            escrow,
            voucher,
            SETTLEMENT_KEY,
            keccak256("zero-key-items"),
            TOTAL_AMOUNT,
            2,
            15,
            NOW_TS,
            NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            zeroKeyItems,
            zeroKeyAuthorization,
            _signSettlementAuthorization(escrow, zeroKeyAuthorization),
            CanonicalResearch.ZeroKey.selector
        );
    }

    function testRejectsMismatchedItemsHashTotalItemCountAndNonceSignature() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);

        ResearchEscrowEip712.SettlementAuthorization memory wrongHashAuthorization = _settlementAuthorization(
            escrow,
            voucher,
            SETTLEMENT_KEY,
            bytes32(uint256(itemsHash) ^ 1),
            TOTAL_AMOUNT,
            2,
            21,
            NOW_TS,
            NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            wrongHashAuthorization,
            _signSettlementAuthorization(escrow, wrongHashAuthorization),
            IResearchEscrowSettlement.InvalidSettlementAuthorization.selector
        );

        ResearchEscrowEip712.SettlementAuthorization memory wrongTotalAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT + 1, 2, 22, NOW_TS, NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            wrongTotalAuthorization,
            _signSettlementAuthorization(escrow, wrongTotalAuthorization),
            IResearchEscrowSettlement.InvalidSettlementAuthorization.selector
        );

        ResearchEscrowEip712.SettlementAuthorization memory wrongItemCountAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 1, 23, NOW_TS, NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            wrongItemCountAuthorization,
            _signSettlementAuthorization(escrow, wrongItemCountAuthorization),
            IResearchEscrowSettlement.InvalidSettlementAuthorization.selector
        );

        ResearchEscrowEip712.SettlementAuthorization memory signedAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 24, NOW_TS, NOW_TS + 5 minutes
        );
        bytes memory signature = _signSettlementAuthorization(escrow, signedAuthorization);
        ResearchEscrowEip712.SettlementAuthorization memory wrongNonceAuthorization = signedAuthorization;
        wrongNonceAuthorization.nonce = 25;
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            wrongNonceAuthorization,
            signature,
            IResearchEscrowSettlement.InvalidSettlementSignature.selector
        );

        ResearchEscrowEip712.SettlementAuthorization memory zeroSettlementKeyAuthorization = _settlementAuthorization(
            escrow, voucher, bytes32(0), itemsHash, TOTAL_AMOUNT, 2, 26, NOW_TS, NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            bytes32(0),
            items,
            zeroSettlementKeyAuthorization,
            _signSettlementAuthorization(escrow, zeroSettlementKeyAuthorization),
            CanonicalResearch.ZeroKey.selector
        );
    }

    function testRejectsSettlementAuthorizationLifetimeAfterExpiryAndExpiredWindow() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);

        ResearchEscrowEip712.SettlementAuthorization memory longLifetimeAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 31, NOW_TS, uint64(NOW_TS + 5 minutes + 1)
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            longLifetimeAuthorization,
            _signSettlementAuthorization(escrow, longLifetimeAuthorization),
            IResearchEscrowSettlement.InvalidSettlementAuthorizationWindow.selector
        );

        uint64 issuedNearExpiry = voucher.expectedExpiresAt - 4 minutes;
        uint64 deadlineAfterExpiry = voucher.expectedExpiresAt + 1;
        VM.warp(issuedNearExpiry);
        ResearchEscrowEip712.SettlementAuthorization memory afterExpiryAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 32, issuedNearExpiry, deadlineAfterExpiry
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            afterExpiryAuthorization,
            _signSettlementAuthorization(escrow, afterExpiryAuthorization),
            IResearchEscrowSettlement.InvalidSettlementAuthorizationWindow.selector
        );

        VM.warp(uint64(NOW_TS + 5 minutes + 1));
        ResearchEscrowEip712.SettlementAuthorization memory expiredAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 33, NOW_TS, NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            expiredAuthorization,
            _signSettlementAuthorization(escrow, expiredAuthorization),
            IResearchEscrowSettlement.InvalidSettlementAuthorizationWindow.selector
        );
    }

    function testRejectsUnauthorizedSettlerIntentSignerRoleDriftAndRoleConflict() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 41, NOW_TS, NOW_TS + 5 minutes
        );
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        VM.expectPartialRevert(IResearchEscrowSettlement.UnauthorizedSettler.selector);
        VM.prank(PAYOUT);
        IResearchEscrowSettlement(escrow).settleBatch(SETTLEMENT_KEY, items, authorization, signature);

        bytes32 intentSignerRole = deployment.factory.INTENT_SIGNER_ROLE();
        VM.prank(FACTORY_ADMIN);
        deployment.factory.revokeRole(intentSignerRole, VM.addr(INTENT_SIGNER_KEY));
        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            signature,
            IResearchEscrowSettlement.InvalidSettlementSigner.selector
        );

        bytes memory hasAdminRole = abi.encodeCall(
            IProjectRoleProbe.hasRole, (deployment.factory.DEFAULT_ADMIN_ROLE(), VM.addr(INTENT_SIGNER_KEY))
        );
        VM.mockCall(address(deployment.factory), hasAdminRole, abi.encode(true));
        _expectSettleRevert(
            escrow, SETTLEMENT_KEY, items, authorization, signature, ResearchEscrow.SensitiveRoleConflict.selector
        );
    }

    function testRejectsSettlementWhenIntentSignerIsSettlerCaller() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 42, NOW_TS, NOW_TS + 5 minutes
        );
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);
        bytes32 settlerRole = deployment.factory.SETTLER_ROLE();
        address intentSigner = voucher.intentSigner;
        bytes memory hasSettlerRole = abi.encodeCall(IProjectRoleProbe.hasRole, (settlerRole, intentSigner));
        VM.mockCall(address(deployment.factory), hasSettlerRole, abi.encode(true));

        VM.expectPartialRevert(IResearchEscrowSettlement.InvalidSettlementSigner.selector);
        VM.prank(intentSigner);
        IResearchEscrowSettlement(escrow).settleBatch(SETTLEMENT_KEY, items, authorization, signature);

        assert(IResearchEscrowSettlement(escrow).spent() == 0);
        assert(!IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_2));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(PAYOUT) == 0);
        assert(deployment.usdc.balanceOf(PAYOUT_TWO) == 0);
    }

    function testRejectsSettlementWithSettlerOnlyWrongIntentSignatureWithoutStateChanges() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 43, NOW_TS, NOW_TS + 5 minutes
        );
        bytes memory wrongSignature = _signSettlementAuthorizationWithKey(escrow, authorization, WRONG_SIGNER_KEY);

        _expectSettleRevertWithoutSettlementState(
            deployment,
            escrow,
            items,
            authorization,
            wrongSignature,
            IResearchEscrowSettlement.InvalidSettlementSignature.selector
        );
    }

    function testRejectsSettlementWhenIntentSignerHasSensitiveRegistryRole() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 44, NOW_TS, NOW_TS + 5 minutes
        );
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);
        bytes32 sourceAdminRole = deployment.registry.SOURCE_ADMIN_ROLE();
        address intentSigner = voucher.intentSigner;
        bytes memory hasSourceAdminRole = abi.encodeCall(IProjectRoleProbe.hasRole, (sourceAdminRole, intentSigner));
        VM.mockCall(address(deployment.registry), hasSourceAdminRole, abi.encode(true));

        _expectSettleRevert(
            escrow, SETTLEMENT_KEY, items, authorization, signature, ResearchEscrow.SensitiveRoleConflict.selector
        );

        assert(IResearchEscrowSettlement(escrow).spent() == 0);
        assert(!IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_2));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(PAYOUT) == 0);
        assert(deployment.usdc.balanceOf(PAYOUT_TWO) == 0);
    }

    function testRejectsFundedExpiredClosedAndBudgetOverrunSettlement() public {
        address buyer = VM.addr(BUYER_KEY);
        (ResearchEscrowEip712.FundingVoucher memory fundedVoucher, address fundedEscrow) = _fundedEscrowOnly(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory fundedAuthorization = _settlementAuthorization(
            fundedEscrow, fundedVoucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, 51, NOW_TS, NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            fundedEscrow,
            SETTLEMENT_KEY,
            items,
            fundedAuthorization,
            _signSettlementAuthorization(fundedEscrow, fundedAuthorization),
            ResearchEscrow.InvalidState.selector
        );

        VM.prank(buyer);
        ResearchEscrow(fundedEscrow).cancelUnactivated();
        _expectSettleRevert(
            fundedEscrow,
            SETTLEMENT_KEY,
            items,
            fundedAuthorization,
            _signSettlementAuthorization(fundedEscrow, fundedAuthorization),
            ResearchEscrow.InvalidState.selector
        );

        (ResearchEscrowEip712.FundingVoucher memory activeVoucher, address activeEscrow) = _activeEscrowOnly(buyer);
        VM.warp(activeVoucher.expectedExpiresAt + 1);
        ResearchEscrowEip712.SettlementAuthorization memory expiredAuthorization = _settlementAuthorization(
            activeEscrow,
            activeVoucher,
            SETTLEMENT_KEY,
            itemsHash,
            TOTAL_AMOUNT,
            2,
            52,
            activeVoucher.expectedExpiresAt - 5 minutes,
            activeVoucher.expectedExpiresAt
        );
        _expectSettleRevert(
            activeEscrow,
            SETTLEMENT_KEY,
            items,
            expiredAuthorization,
            _signSettlementAuthorization(activeEscrow, expiredAuthorization),
            IResearchEscrowSettlement.InvalidSettlementAuthorizationWindow.selector
        );

        (
            FactoryDeployment memory budgetDeployment,
            ResearchEscrowEip712.FundingVoucher memory budgetVoucher,
            address budgetEscrow
        ) = _activeEscrow(buyer);
        VM.prank(SOURCE_ADMIN);
        budgetDeployment.registry.updateSource(SOURCE_ID_1, PAYOUT, BUDGET_UNITS + 1, true);

        CanonicalResearch.SettlementItem[] memory overBudgetItems = new CanonicalResearch.SettlementItem[](1);
        overBudgetItems[0] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY_1,
            sourceId: SOURCE_ID_1,
            registryRevision: 2,
            expectedPayout: PAYOUT,
            maxUnitPrice: BUDGET_UNITS + 1,
            amount: BUDGET_UNITS + 1
        });
        bytes32 overBudgetHash = CanonicalResearch.itemsHash(overBudgetItems);
        ResearchEscrowEip712.SettlementAuthorization memory overBudgetAuthorization = _settlementAuthorization(
            budgetEscrow,
            budgetVoucher,
            SETTLEMENT_KEY,
            overBudgetHash,
            BUDGET_UNITS + 1,
            1,
            53,
            NOW_TS,
            NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            budgetEscrow,
            SETTLEMENT_KEY,
            overBudgetItems,
            overBudgetAuthorization,
            _signSettlementAuthorization(budgetEscrow, overBudgetAuthorization),
            IResearchEscrowSettlement.SettlementBudgetExceeded.selector
        );
    }

    function testRejectsRegistryRevisionChangeAfterIntentSnapshot() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _singleSourceOneItem(PAYOUT, 1000, FIRST_AMOUNT);
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, FIRST_AMOUNT, 1, 61, NOW_TS, NOW_TS + 5 minutes
        );
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        VM.prank(SOURCE_ADMIN);
        deployment.registry.updateSource(SOURCE_ID_1, PAYOUT, 1000, true);

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            signature,
            IResearchEscrowSettlement.RegistrySnapshotMismatch.selector
        );
    }

    function testRejectsRegistryPayoutChangeAfterIntentSnapshot() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _singleSourceOneItem(PAYOUT, 1000, FIRST_AMOUNT);
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, FIRST_AMOUNT, 1, 62, NOW_TS, NOW_TS + 5 minutes
        );
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        VM.prank(SOURCE_ADMIN);
        deployment.registry.updateSource(SOURCE_ID_1, PAYOUT_THREE, 1000, true);

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            signature,
            IResearchEscrowSettlement.RegistrySnapshotMismatch.selector
        );
    }

    function testRejectsRegistryMaxChangeAfterIntentSnapshot() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _singleSourceOneItem(PAYOUT, 1000, 50);
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization =
            _settlementAuthorization(escrow, voucher, SETTLEMENT_KEY, itemsHash, 50, 1, 63, NOW_TS, NOW_TS + 5 minutes);
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        VM.prank(SOURCE_ADMIN);
        deployment.registry.updateSource(SOURCE_ID_1, PAYOUT, 900, true);

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            signature,
            IResearchEscrowSettlement.RegistrySnapshotMismatch.selector
        );
    }

    function testRejectsInactiveRegistrySourceAfterIntentSnapshot() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _singleSourceOneItem(PAYOUT, 1000, FIRST_AMOUNT);
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, FIRST_AMOUNT, 1, 64, NOW_TS, NOW_TS + 5 minutes
        );
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        VM.prank(SOURCE_ADMIN);
        deployment.registry.updateSource(SOURCE_ID_1, PAYOUT, 1000, false);

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            signature,
            IResearchEscrowSettlement.RegistrySourceInactive.selector
        );
    }

    function testRejectsBatchWhenSecondItemSnapshotDriftsAfterWorkerPreread() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization =
            _validSettlementAuthorization(escrow, voucher, itemsHash, 66);
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);
        uint256 escrowBefore = deployment.usdc.balanceOf(escrow);
        uint256 payoutOneBefore = deployment.usdc.balanceOf(PAYOUT);
        uint256 payoutTwoBefore = deployment.usdc.balanceOf(PAYOUT_TWO);

        VM.prank(SOURCE_ADMIN);
        deployment.registry.updateSource(SOURCE_ID_2, PAYOUT_THREE, 1000, true);

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            signature,
            IResearchEscrowSettlement.RegistrySnapshotMismatch.selector
        );

        assert(IResearchEscrowSettlement(escrow).spent() == 0);
        assert(!IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_2));
        assert(deployment.usdc.balanceOf(escrow) == escrowBefore);
        assert(deployment.usdc.balanceOf(PAYOUT) == payoutOneBefore);
        assert(deployment.usdc.balanceOf(PAYOUT_TWO) == payoutTwoBefore);
    }

    function testRejectsSettlementItemAmountAboveRegistryMax() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.SettlementItem[] memory items = _singleSourceOneItem(PAYOUT, 1000, 1001);
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, 1001, 1, 65, NOW_TS, NOW_TS + 5 minutes
        );

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            _signSettlementAuthorization(escrow, authorization),
            IResearchEscrowSettlement.SettlementItemAmountExceedsMax.selector
        );
    }

    function testRejectsZeroBuyerEscrowFactoryRegistryAndUsdcPayouts() public {
        for (uint8 payoutKind = 0; payoutKind < 6; ++payoutKind) {
            _expectMockedSensitivePayoutRevert(payoutKind, 71 + payoutKind);
        }
    }

    function testRejectsFactorySensitiveRoleMemberPayouts() public {
        _expectRoleMemberPayoutRevert(FACTORY_ADMIN, 81);
        _expectRoleMemberPayoutRevert(VM.addr(FUNDING_SIGNER_KEY), 82);
        _expectRoleMemberPayoutRevert(VM.addr(INTENT_SIGNER_KEY), 83);
        _expectRoleMemberPayoutRevert(SETTLER, 84);
    }

    function testRejectsRegistrySensitiveRoleMemberPayouts() public {
        _expectRoleMemberPayoutRevert(REGISTRY_ADMIN, 91);
        _expectRoleMemberPayoutRevert(SOURCE_ADMIN, 92);
    }

    function testRejectsSelfTransferPayoutWithoutChangingBalances() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        bytes memory getSourceCall = abi.encodeCall(DataSourceRegistry.getSource, (SOURCE_ID_1));
        VM.mockCall(address(deployment.registry), getSourceCall, abi.encode(uint64(1), escrow, uint256(1000), true));
        CanonicalResearch.SettlementItem[] memory items = _singleSourceOneItem(escrow, 1000, FIRST_AMOUNT);
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, FIRST_AMOUNT, 1, 101, NOW_TS, NOW_TS + 5 minutes
        );
        uint256 escrowBefore = deployment.usdc.balanceOf(escrow);

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            _signSettlementAuthorization(escrow, authorization),
            IResearchEscrowSettlement.SensitivePayout.selector
        );

        assert(deployment.usdc.balanceOf(escrow) == escrowBefore);
        assert(IResearchEscrowSettlement(escrow).spent() == 0);
        assert(!IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));
    }

    function testFeeOnTransferSettlementRollsBackWithoutPartialPayment() public {
        _expectTokenRuntimeSettleRevertWithoutState(
            address(new FeeOnTransferToken()).code,
            IResearchEscrowSettlement.SettlementBalanceDeltaMismatch.selector,
            111
        );
    }

    function testFalseReturnTokenSettlementRollsBackWithoutState() public {
        _expectTokenRuntimeSettleRevertWithoutState(
            address(new FalseReturnToken()).code, SafeERC20.SafeERC20FailedOperation.selector, 112
        );
    }

    function testRevertingTokenSettlementRollsBackWithoutState() public {
        _expectTokenRuntimeSettleRevertWithoutState(
            address(new RevertingToken()).code, RevertingTokenTransferBlocked.selector, 113
        );
    }

    function testReentrantTokenSettlementRollsBackWithoutState() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        VM.etch(ARC_TESTNET_USDC, address(new ReentrantToken()).code);

        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization =
            _validSettlementAuthorization(escrow, voucher, itemsHash, 114);
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);
        ReentrantToken(ARC_TESTNET_USDC)
            .configureCallback(
                escrow,
                abi.encodeCall(IResearchEscrowSettlement.settleBatch, (SETTLEMENT_KEY, items, authorization, signature))
            );

        _expectSettleRevertWithoutSettlementState(
            deployment, escrow, items, authorization, signature, ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
    }

    function testRejectsSettlementKeyReplayAfterSuccess() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization =
            _validSettlementAuthorization(escrow, voucher, itemsHash, 121);
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        _settleAsSettler(escrow, SETTLEMENT_KEY, items, authorization, signature);
        uint256 spentAfterFirstSettle = IResearchEscrowSettlement(escrow).spent();
        uint256 escrowAfterFirstSettle = deployment.usdc.balanceOf(escrow);
        uint256 payoutOneAfterFirstSettle = deployment.usdc.balanceOf(PAYOUT);
        uint256 payoutTwoAfterFirstSettle = deployment.usdc.balanceOf(PAYOUT_TWO);

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY,
            items,
            authorization,
            signature,
            IResearchEscrowSettlement.InvalidSettlementAuthorization.selector
        );

        assert(IResearchEscrowSettlement(escrow).spent() == spentAfterFirstSettle);
        assert(deployment.usdc.balanceOf(escrow) == escrowAfterFirstSettle);
        assert(deployment.usdc.balanceOf(PAYOUT) == payoutOneAfterFirstSettle);
        assert(deployment.usdc.balanceOf(PAYOUT_TWO) == payoutTwoAfterFirstSettle);
    }

    function testRejectsRequestKeyReplayAcrossDifferentSettlementKey() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory firstAuthorization =
            _validSettlementAuthorization(escrow, voucher, itemsHash, 122);
        _settleAsSettler(
            escrow, SETTLEMENT_KEY, items, firstAuthorization, _signSettlementAuthorization(escrow, firstAuthorization)
        );

        ResearchEscrowEip712.SettlementAuthorization memory replayedRequestAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY_TWO, itemsHash, TOTAL_AMOUNT, 2, 123, NOW_TS, NOW_TS + 5 minutes
        );
        uint256 spentAfterFirstSettle = IResearchEscrowSettlement(escrow).spent();

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY_TWO,
            items,
            replayedRequestAuthorization,
            _signSettlementAuthorization(escrow, replayedRequestAuthorization),
            IResearchEscrowSettlement.InvalidSettlementAuthorization.selector
        );

        assert(IResearchEscrowSettlement(escrow).spent() == spentAfterFirstSettle);
        assert(!IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY_TWO));
        assert(deployment.usdc.balanceOf(PAYOUT) == FIRST_AMOUNT);
        assert(deployment.usdc.balanceOf(PAYOUT_TWO) == SECOND_AMOUNT);
    }

    function testSettlementFailureDoesNotConsumeKeysAndCanRetryWithUpdatedSnapshot() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory staleItems = _singleSourceOneItem(PAYOUT, 1000, FIRST_AMOUNT);
        bytes32 staleItemsHash = CanonicalResearch.itemsHash(staleItems);
        ResearchEscrowEip712.SettlementAuthorization memory staleAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY_TWO, staleItemsHash, FIRST_AMOUNT, 1, 124, NOW_TS, NOW_TS + 5 minutes
        );

        VM.prank(SOURCE_ADMIN);
        deployment.registry.updateSource(SOURCE_ID_1, PAYOUT_THREE, 1000, true);

        _expectSettleRevert(
            escrow,
            SETTLEMENT_KEY_TWO,
            staleItems,
            staleAuthorization,
            _signSettlementAuthorization(escrow, staleAuthorization),
            IResearchEscrowSettlement.RegistrySnapshotMismatch.selector
        );
        assert(!IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY_TWO));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));

        CanonicalResearch.SettlementItem[] memory retryItems =
            _singleSourceOneItemAtRevision(2, PAYOUT_THREE, 1000, FIRST_AMOUNT);
        bytes32 retryItemsHash = CanonicalResearch.itemsHash(retryItems);
        ResearchEscrowEip712.SettlementAuthorization memory retryAuthorization = _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY_TWO, retryItemsHash, FIRST_AMOUNT, 1, 125, NOW_TS, NOW_TS + 5 minutes
        );
        _settleAsSettler(
            escrow,
            SETTLEMENT_KEY_TWO,
            retryItems,
            retryAuthorization,
            _signSettlementAuthorization(escrow, retryAuthorization)
        );

        assert(IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY_TWO));
        assert(IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));
        assert(IResearchEscrowSettlement(escrow).spent() == FIRST_AMOUNT);
        assert(deployment.usdc.balanceOf(PAYOUT_THREE) == FIRST_AMOUNT);

        (bytes32 recordedItemsHash, uint256 recordedTotal, uint32 recordedItemCount) =
            IResearchEscrowSettlement(escrow).settlementResult(SETTLEMENT_KEY_TWO);
        assert(recordedItemsHash == retryItemsHash);
        assert(recordedTotal == FIRST_AMOUNT);
        assert(recordedItemCount == 1);
    }

    function testDeploymentBlockLogScanRecoversSettlementSummaryFromIndexedEvents() public {
        VM.recordLogs();

        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization =
            _validSettlementAuthorization(escrow, voucher, itemsHash, 126);
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        _settleAsSettler(escrow, SETTLEMENT_KEY, items, authorization, signature);
        SettlementVm.RecordedLog[] memory recordedLogs = VM.getRecordedLogs();

        bytes32 batchTopic = keccak256("ResearchEscrowSettled(bytes32,bytes32,uint256,uint32)");
        bytes32 itemTopic = keccak256("ResearchEscrowSettlementItem(bytes32,bytes32,bytes32,address,uint256)");
        uint256 batchEvents;
        uint256 recoveredPayoutTotal;
        bool sawBatch;
        uint256 sawItems;
        for (uint256 index = 0; index < recordedLogs.length; ++index) {
            SettlementVm.RecordedLog memory recordedLog = recordedLogs[index];
            if (recordedLog.emitter != escrow || recordedLog.topics.length == 0) {
                continue;
            }
            if (recordedLog.topics[0] == batchTopic) {
                ++batchEvents;
                assert(recordedLog.topics.length == 3);
                assert(recordedLog.topics[1] == SETTLEMENT_KEY);
                assert(recordedLog.topics[2] == itemsHash);
                (uint256 eventTotal, uint32 eventItemCount) = abi.decode(recordedLog.data, (uint256, uint32));
                assert(eventTotal == TOTAL_AMOUNT);
                assert(eventItemCount == 2);
                sawBatch = true;
            }
            if (recordedLog.topics[0] == itemTopic) {
                assert(recordedLog.topics.length == 4);
                assert(recordedLog.topics[1] == SETTLEMENT_KEY);
                (address recordedPayout, uint256 recordedAmount) = abi.decode(recordedLog.data, (address, uint256));
                recoveredPayoutTotal += recordedAmount;
                if (recordedLog.topics[2] == REQUEST_KEY_1) {
                    assert(recordedLog.topics[3] == SOURCE_ID_1);
                    assert(recordedPayout == PAYOUT);
                    assert(recordedAmount == FIRST_AMOUNT);
                    ++sawItems;
                } else if (recordedLog.topics[2] == REQUEST_KEY_2) {
                    assert(recordedLog.topics[3] == SOURCE_ID_2);
                    assert(recordedPayout == PAYOUT_TWO);
                    assert(recordedAmount == SECOND_AMOUNT);
                    ++sawItems;
                }
            }
        }

        assert(batchEvents == 1);
        assert(sawBatch);
        assert(sawItems == 2);
        assert(recoveredPayoutTotal == TOTAL_AMOUNT);
        assert(IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));
        assert(IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_2));
        assert(IResearchEscrowSettlement(escrow).spent() == TOTAL_AMOUNT);
        assert(deployment.usdc.balanceOf(PAYOUT) == FIRST_AMOUNT);
        assert(deployment.usdc.balanceOf(PAYOUT_TWO) == SECOND_AMOUNT);

        (bytes32 recordedItemsHash, uint256 recordedTotal, uint32 recordedItemCount) =
            IResearchEscrowSettlement(escrow).settlementResult(SETTLEMENT_KEY);
        assert(recordedItemsHash == itemsHash);
        assert(recordedTotal == TOTAL_AMOUNT);
        assert(recordedItemCount == 2);
    }

    function _activeEscrow(address buyer)
        private
        returns (
            FactoryDeployment memory deployment,
            ResearchEscrowEip712.FundingVoucher memory voucher,
            address escrow
        )
    {
        (deployment, voucher, escrow) = _fundedEscrow(buyer);

        ResearchEscrowEip712.ActivationAuthorization memory activation =
            _validActivation(escrow, voucher, 1, NOW_TS + 10 minutes);
        bytes memory activationSignature = _signActivation(escrow, activation, BUYER_KEY);

        VM.prank(SETTLER);
        IResearchEscrowSettlement(escrow).activate(activation, activationSignature);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
    }

    function _activeEscrowOnly(address buyer)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow)
    {
        (, voucher, escrow) = _activeEscrow(buyer);
    }

    function _fundedEscrow(address buyer)
        private
        returns (
            FactoryDeployment memory deployment,
            ResearchEscrowEip712.FundingVoucher memory voucher,
            address escrow
        )
    {
        deployment = _publishedFactoryWithMockUsdc();
        _configureSources(deployment.registry);
        voucher = _validFundingVoucher(deployment.factory, buyer, 1);
        bytes memory fundingSignature = _signFundingVoucher(deployment.factory, voucher);
        deployment.usdc.mint(buyer, BUDGET_UNITS);

        VM.prank(buyer);
        assert(deployment.usdc.approve(address(deployment.factory), BUDGET_UNITS));

        VM.prank(buyer);
        escrow = deployment.factory.createAndFund(voucher, fundingSignature);
    }

    function _fundedEscrowOnly(address buyer)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow)
    {
        (, voucher, escrow) = _fundedEscrow(buyer);
    }

    function _publishedFactoryWithMockUsdc() private returns (FactoryDeployment memory deployment) {
        VM.etch(ARC_TESTNET_USDC, address(new MockUSDC()).code);
        deployment.usdc = MockUSDC(ARC_TESTNET_USDC);
        deployment.implementation = new ResearchEscrow();
        deployment.registry = new DataSourceRegistry(DEPLOYMENT_KEY);
        deployment.factory =
            new ResearchEscrowFactory(address(deployment.implementation), address(deployment.registry), DEPLOYMENT_KEY);
        bytes32 factoryAdminRole = deployment.factory.DEFAULT_ADMIN_ROLE();
        bytes32 registryAdminRole = deployment.registry.DEFAULT_ADMIN_ROLE();
        bytes32 fundingSignerRole = deployment.factory.FUNDING_SIGNER_ROLE();
        bytes32 intentSignerRole = deployment.factory.INTENT_SIGNER_ROLE();
        bytes32 settlerRole = deployment.factory.SETTLER_ROLE();
        bytes32 sourceAdminRole = deployment.registry.SOURCE_ADMIN_ROLE();

        VM.prank(DEPLOYMENT_KEY);
        deployment.registry.bindFactory(address(deployment.factory));

        VM.prank(DEPLOYMENT_KEY);
        deployment.factory.grantRole(factoryAdminRole, FACTORY_ADMIN);
        VM.prank(DEPLOYMENT_KEY);
        deployment.registry.grantRole(registryAdminRole, REGISTRY_ADMIN);

        VM.prank(DEPLOYMENT_KEY);
        deployment.factory.grantRole(fundingSignerRole, VM.addr(FUNDING_SIGNER_KEY));
        VM.prank(DEPLOYMENT_KEY);
        deployment.factory.grantRole(intentSignerRole, VM.addr(INTENT_SIGNER_KEY));
        VM.prank(DEPLOYMENT_KEY);
        deployment.factory.grantRole(settlerRole, SETTLER);

        VM.prank(REGISTRY_ADMIN);
        deployment.registry.grantRole(sourceAdminRole, SOURCE_ADMIN);

        VM.prank(FACTORY_ADMIN);
        deployment.factory.revokeRole(factoryAdminRole, DEPLOYMENT_KEY);
        VM.prank(REGISTRY_ADMIN);
        deployment.registry.revokeRole(registryAdminRole, DEPLOYMENT_KEY);
        VM.warp(NOW_TS);
    }

    function _configureSources(DataSourceRegistry registry) private {
        VM.prank(SOURCE_ADMIN);
        registry.createSource(SOURCE_ID_1, PAYOUT, 1000, true);
        VM.prank(SOURCE_ADMIN);
        registry.createSource(SOURCE_ID_2, PAYOUT_TWO, 1000, true);
    }

    function _validItems() private pure returns (CanonicalResearch.SettlementItem[] memory items) {
        items = new CanonicalResearch.SettlementItem[](2);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY_1,
            sourceId: SOURCE_ID_1,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: 1000,
            amount: FIRST_AMOUNT
        });
        items[1] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY_2,
            sourceId: SOURCE_ID_2,
            registryRevision: 1,
            expectedPayout: PAYOUT_TWO,
            maxUnitPrice: 1000,
            amount: SECOND_AMOUNT
        });
    }

    function _singleSourceOneItem(address payout, uint256 maxUnitPrice, uint256 amount)
        private
        pure
        returns (CanonicalResearch.SettlementItem[] memory items)
    {
        return _singleSourceOneItemAtRevision(1, payout, maxUnitPrice, amount);
    }

    function _singleSourceOneItemAtRevision(
        uint64 registryRevision,
        address payout,
        uint256 maxUnitPrice,
        uint256 amount
    ) private pure returns (CanonicalResearch.SettlementItem[] memory items) {
        items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY_1,
            sourceId: SOURCE_ID_1,
            registryRevision: registryRevision,
            expectedPayout: payout,
            maxUnitPrice: maxUnitPrice,
            amount: amount
        });
    }

    function _sequentialItems(uint256 itemCount, uint256 amount)
        private
        pure
        returns (CanonicalResearch.SettlementItem[] memory items)
    {
        items = new CanonicalResearch.SettlementItem[](itemCount);
        for (uint256 index = 0; index < itemCount; ++index) {
            items[index] = CanonicalResearch.SettlementItem({
                requestKey: bytes32(uint256(REQUEST_KEY_1) + index),
                sourceId: SOURCE_ID_1,
                registryRevision: 1,
                expectedPayout: PAYOUT,
                maxUnitPrice: 1000,
                amount: amount
            });
        }
    }

    function _validFundingVoucher(ResearchEscrowFactory factory, address buyer, uint256 nonce)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory)
    {
        return ResearchEscrowEip712.FundingVoucher({
            buyer: buyer,
            researchKey: RESEARCH_KEY,
            budgetUnits: BUDGET_UNITS,
            expectedExpiresAt: uint64(NOW_TS + factory.MIN_ESCROW_TTL()),
            fundingDeadline: FUNDING_DEADLINE,
            intentSigner: VM.addr(INTENT_SIGNER_KEY),
            voucherNonce: nonce
        });
    }

    function _validActivation(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        uint256 nonce,
        uint64 deadline
    ) private pure returns (ResearchEscrowEip712.ActivationAuthorization memory) {
        return ResearchEscrowEip712.ActivationAuthorization({
                escrow: escrow,
                researchKey: voucher.researchKey,
                buyer: voucher.buyer,
                intentSigner: voucher.intentSigner,
                initialBudget: voucher.budgetUnits,
                expectedExpiresAt: voucher.expectedExpiresAt,
                activationNonce: nonce,
                deadline: deadline
            });
    }

    function _validSettlementAuthorization(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes32 itemsHash,
        uint256 nonce
    ) private pure returns (ResearchEscrowEip712.SettlementAuthorization memory) {
        return _settlementAuthorization(
            escrow, voucher, SETTLEMENT_KEY, itemsHash, TOTAL_AMOUNT, 2, nonce, NOW_TS, uint64(NOW_TS + 5 minutes)
        );
    }

    function _settlementAuthorization(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes32 settlementKey,
        bytes32 itemsHash,
        uint256 total,
        uint32 itemCount,
        uint256 nonce,
        uint64 issuedAt,
        uint64 deadline
    ) private pure returns (ResearchEscrowEip712.SettlementAuthorization memory) {
        return ResearchEscrowEip712.SettlementAuthorization({
            escrow: escrow,
            researchKey: voucher.researchKey,
            settlementKey: settlementKey,
            itemsHash: itemsHash,
            total: total,
            itemCount: itemCount,
            nonce: nonce,
            issuedAt: issuedAt,
            deadline: deadline
        });
    }

    function _signFundingVoucher(ResearchEscrowFactory factory, ResearchEscrowEip712.FundingVoucher memory voucher)
        private
        returns (bytes memory)
    {
        bytes32 digest = ResearchEscrowEip712.fundingVoucherDigest(block.chainid, address(factory), voucher);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(FUNDING_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signActivation(
        address escrow,
        ResearchEscrowEip712.ActivationAuthorization memory authorization,
        uint256 privateKey
    ) private returns (bytes memory) {
        bytes32 digest = ResearchEscrowEip712.activationAuthorizationDigest(block.chainid, escrow, authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signSettlementAuthorization(
        address escrow,
        ResearchEscrowEip712.SettlementAuthorization memory authorization
    ) private returns (bytes memory) {
        return _signSettlementAuthorizationWithKey(escrow, authorization, INTENT_SIGNER_KEY);
    }

    function _signSettlementAuthorizationWithKey(
        address escrow,
        ResearchEscrowEip712.SettlementAuthorization memory authorization,
        uint256 privateKey
    ) private returns (bytes memory) {
        bytes32 digest = ResearchEscrowEip712.settlementAuthorizationDigest(block.chainid, escrow, authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);

        return abi.encodePacked(r, s, v);
    }

    function _expectMockedSensitivePayoutRevert(uint8 payoutKind, uint256 nonce) private {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        address sensitivePayout = _protocolSensitivePayout(payoutKind, deployment, escrow, buyer);
        bytes memory getSourceCall = abi.encodeCall(DataSourceRegistry.getSource, (SOURCE_ID_1));
        VM.mockCall(
            address(deployment.registry), getSourceCall, abi.encode(uint64(1), sensitivePayout, uint256(1000), true)
        );

        CanonicalResearch.SettlementItem[] memory items = _singleSourceOneItem(sensitivePayout, 1000, FIRST_AMOUNT);
        _expectSignedSettleRevert(
            escrow,
            voucher,
            SETTLEMENT_KEY,
            items,
            FIRST_AMOUNT,
            nonce,
            IResearchEscrowSettlement.SensitivePayout.selector
        );
    }

    function _expectRoleMemberPayoutRevert(address sensitivePayout, uint256 nonce) private {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);

        VM.prank(SOURCE_ADMIN);
        deployment.registry.updateSource(SOURCE_ID_1, sensitivePayout, 1000, true);

        CanonicalResearch.SettlementItem[] memory items =
            _singleSourceOneItemAtRevision(2, sensitivePayout, 1000, FIRST_AMOUNT);
        _expectSignedSettleRevert(
            escrow,
            voucher,
            SETTLEMENT_KEY,
            items,
            FIRST_AMOUNT,
            nonce,
            IResearchEscrowSettlement.SensitivePayout.selector
        );
    }

    function _expectTokenRuntimeSettleRevertWithoutState(
        bytes memory runtimeCode,
        bytes4 expectedSelector,
        uint256 nonce
    ) private {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        VM.etch(ARC_TESTNET_USDC, runtimeCode);

        CanonicalResearch.SettlementItem[] memory items = _validItems();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization =
            _validSettlementAuthorization(escrow, voucher, itemsHash, nonce);
        _expectSettleRevertWithoutSettlementState(
            deployment,
            escrow,
            items,
            authorization,
            _signSettlementAuthorization(escrow, authorization),
            expectedSelector
        );
    }

    function _expectSettleRevertWithoutSettlementState(
        FactoryDeployment memory deployment,
        address escrow,
        CanonicalResearch.SettlementItem[] memory items,
        ResearchEscrowEip712.SettlementAuthorization memory authorization,
        bytes memory signature,
        bytes4 expectedSelector
    ) private {
        uint256 escrowBefore = deployment.usdc.balanceOf(escrow);
        uint256 payoutOneBefore = deployment.usdc.balanceOf(PAYOUT);
        uint256 payoutTwoBefore = deployment.usdc.balanceOf(PAYOUT_TWO);

        _expectSettleRevert(escrow, SETTLEMENT_KEY, items, authorization, signature, expectedSelector);

        assert(IResearchEscrowSettlement(escrow).spent() == 0);
        assert(!IResearchEscrowSettlement(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_1));
        assert(!IResearchEscrowSettlement(escrow).processedRequestKey(REQUEST_KEY_2));
        assert(deployment.usdc.balanceOf(escrow) == escrowBefore);
        assert(deployment.usdc.balanceOf(PAYOUT) == payoutOneBefore);
        assert(deployment.usdc.balanceOf(PAYOUT_TWO) == payoutTwoBefore);
    }

    function _expectSignedSettleRevert(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes32 settlementKey,
        CanonicalResearch.SettlementItem[] memory items,
        uint256 total,
        uint256 nonce,
        bytes4 expectedSelector
    ) private {
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = _settlementAuthorization(
            escrow, voucher, settlementKey, itemsHash, total, uint32(items.length), nonce, NOW_TS, NOW_TS + 5 minutes
        );
        _expectSettleRevert(
            escrow,
            settlementKey,
            items,
            authorization,
            _signSettlementAuthorization(escrow, authorization),
            expectedSelector
        );
    }

    function _expectSettleRevert(
        address escrow,
        bytes32 settlementKey,
        CanonicalResearch.SettlementItem[] memory items,
        ResearchEscrowEip712.SettlementAuthorization memory authorization,
        bytes memory signature,
        bytes4 expectedSelector
    ) private {
        VM.expectPartialRevert(expectedSelector);
        VM.prank(SETTLER);
        IResearchEscrowSettlement(escrow).settleBatch(settlementKey, items, authorization, signature);
    }

    function _settleAsSettler(
        address escrow,
        bytes32 settlementKey,
        CanonicalResearch.SettlementItem[] memory items,
        ResearchEscrowEip712.SettlementAuthorization memory authorization,
        bytes memory signature
    ) private {
        VM.prank(SETTLER);
        IResearchEscrowSettlement(escrow).settleBatch(settlementKey, items, authorization, signature);
    }

    function _protocolSensitivePayout(
        uint8 payoutKind,
        FactoryDeployment memory deployment,
        address escrow,
        address buyer
    ) private pure returns (address) {
        if (payoutKind == 0) {
            return address(0);
        }
        if (payoutKind == 1) {
            return buyer;
        }
        if (payoutKind == 2) {
            return escrow;
        }
        if (payoutKind == 3) {
            return address(deployment.factory);
        }
        if (payoutKind == 4) {
            return address(deployment.registry);
        }

        return ARC_TESTNET_USDC;
    }
}
