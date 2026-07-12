// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CanonicalResearch} from "../../../src/canonical/CanonicalResearch.sol";
import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";
import {ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {MockUSDC} from "../../fixtures/tokens/MockUSDC.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface EventReconstructionVm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract ResearchEscrowEventReconstructionTest is RoleIsolationFixture {
    EventReconstructionVm private constant VM =
        EventReconstructionVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant REQUEST_KEY = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 private constant SETTLEMENT_KEY = 0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7;
    bytes32 private constant SOURCE_ID = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;
    uint256 private constant BUDGET_UNITS = 1_000_000;
    uint256 private constant AMOUNT = 100;
    uint256 private constant SOURCE_MAX_PRICE = 2_000;
    uint256 private constant EXCESS_UNITS = 12_345;
    uint256 private constant POST_CLOSE_EXCESS_UNITS = 7_654;
    uint64 private constant NOW_TS = 1_999_960_000;
    uint64 private constant FUNDING_DEADLINE = NOW_TS + 15 minutes;
    uint256 private constant BUYER_KEY = 0xB001;
    uint256 private constant FUNDING_SIGNER_KEY = 0xF001;
    uint256 private constant INTENT_SIGNER_KEY = 0x1A01;
    address private constant ANY_ACCOUNT = address(0xB0B);
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    event FactoryBound(address indexed factory);
    event SourceConfigured(
        bytes32 indexed sourceId, uint64 indexed revision, address payout, uint256 maxUnitPrice, bool active
    );
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
    event ResearchEscrowActivated(
        address indexed buyer,
        bytes32 indexed researchKey,
        address indexed intentSigner,
        uint256 activationNonce,
        uint64 deadline
    );
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

    struct FactoryDeployment {
        ResearchEscrow implementation;
        DataSourceRegistry registry;
        ResearchEscrowFactory factory;
        MockUSDC usdc;
    }

    function testEventsAndReadInterfacesRebuildHappyPathThroughSignedClose() public {
        address buyer = VM.addr(BUYER_KEY);
        FactoryDeployment memory deployment = _deployPublishedFactory();

        VM.expectEmit(true, true, false, true, address(deployment.registry));
        emit SourceConfigured(SOURCE_ID, 1, PAYOUT, 1_000, true);
        VM.prank(SOURCE_ADMIN);
        deployment.registry.createSource(SOURCE_ID, PAYOUT, 1_000, true);

        VM.expectEmit(true, true, false, true, address(deployment.registry));
        emit SourceConfigured(SOURCE_ID, 2, PAYOUT, SOURCE_MAX_PRICE, true);
        VM.prank(SOURCE_ADMIN);
        deployment.registry.updateSource(SOURCE_ID, PAYOUT, SOURCE_MAX_PRICE, true);

        (uint64 revision, address payout, uint256 maxUnitPrice, bool active) = deployment.registry.getSource(SOURCE_ID);
        assert(revision == 2);
        assert(payout == PAYOUT);
        assert(maxUnitPrice == SOURCE_MAX_PRICE);
        assert(active);

        ResearchEscrowEip712.FundingVoucher memory voucher = _validFundingVoucher(deployment.factory, buyer, 1);
        address predicted = deployment.factory.predictEscrow(buyer, RESEARCH_KEY);
        deployment.usdc.mint(buyer, BUDGET_UNITS);
        VM.prank(buyer);
        assert(deployment.usdc.approve(address(deployment.factory), BUDGET_UNITS));

        VM.expectEmit(true, true, true, true, address(deployment.factory));
        emit ResearchEscrowCreated(buyer, RESEARCH_KEY, predicted, address(deployment.implementation));
        VM.expectEmit(true, true, true, true, address(deployment.factory));
        emit ResearchEscrowFunded(
            buyer, RESEARCH_KEY, predicted, BUDGET_UNITS, voucher.expectedExpiresAt, voucher.fundingDeadline
        );
        VM.prank(buyer);
        address escrow = deployment.factory.createAndFund(voucher, _signFundingVoucher(deployment.factory, voucher));

        assert(escrow == predicted);
        assert(deployment.factory.escrowOf(buyer, RESEARCH_KEY) == escrow);
        _assertFundedReads(deployment, escrow, voucher);

        ResearchEscrowEip712.ActivationAuthorization memory activation =
            _validActivation(escrow, voucher, 11, NOW_TS + 10 minutes);
        VM.expectEmit(true, true, true, true, escrow);
        emit ResearchEscrowActivated(buyer, RESEARCH_KEY, voucher.intentSigner, 11, NOW_TS + 10 minutes);
        VM.prank(SETTLER);
        ResearchEscrow(escrow).activate(activation, _signActivation(escrow, activation));

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
        assert(ResearchEscrow(escrow).activeIntentSigner() == voucher.intentSigner);
        assert(ResearchEscrow(escrow).activationNonceUsed(11));

        bytes32 itemsHash = _settleAndAssertReads(escrow, voucher);
        _closeAndAssertReads(deployment, escrow, voucher, itemsHash);
    }

    function testRefundAndRecoveryEventsCanBeRebuiltWithReadInterfaces() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer, 41);
        deployment.usdc.mint(escrow, EXCESS_UNITS);

        VM.warp(voucher.expectedExpiresAt);
        VM.expectEmit(true, true, false, true, escrow);
        emit ResearchEscrowExpiredRefunded(buyer, RESEARCH_KEY, BUDGET_UNITS, EXCESS_UNITS);
        ResearchEscrow(escrow).refundExpired();

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(ResearchEscrow(escrow).budgetRefund() == BUDGET_UNITS);
        assert(ResearchEscrow(escrow).excessRefund() == EXCESS_UNITS);
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS + EXCESS_UNITS);

        (, address recoveryEscrow) = _fundedEscrowOnly(buyer, 42);
        VM.prank(buyer);
        ResearchEscrow(recoveryEscrow).cancelUnactivated();
        deployment.usdc.mint(recoveryEscrow, POST_CLOSE_EXCESS_UNITS);

        VM.expectEmit(true, true, false, true, recoveryEscrow);
        emit ResearchEscrowExcessRecovered(buyer, RESEARCH_KEY, POST_CLOSE_EXCESS_UNITS);
        VM.prank(ANY_ACCOUNT);
        ResearchEscrow(recoveryEscrow).recoverExcess();

        assert(ResearchEscrow(recoveryEscrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(ResearchEscrow(recoveryEscrow).excessBalance() == 0);
        assert(deployment.usdc.balanceOf(recoveryEscrow) == 0);
    }

    function _settleAndAssertReads(address escrow, ResearchEscrowEip712.FundingVoucher memory voucher)
        private
        returns (bytes32 itemsHash)
    {
        CanonicalResearch.SettlementItem[] memory items = _singleItem(PAYOUT);
        itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory settlement =
            _settlementAuthorization(escrow, voucher, itemsHash, 21);

        VM.expectEmit(true, true, false, true, escrow);
        emit ResearchEscrowSettled(SETTLEMENT_KEY, itemsHash, AMOUNT, 1);
        VM.expectEmit(true, true, true, true, escrow);
        emit ResearchEscrowSettlementItem(SETTLEMENT_KEY, REQUEST_KEY, SOURCE_ID, PAYOUT, AMOUNT);
        VM.prank(SETTLER);
        ResearchEscrow(escrow).settleBatch(SETTLEMENT_KEY, items, settlement, _signSettlement(escrow, settlement));

        (bytes32 recordedItemsHash, uint256 recordedTotal, uint32 recordedItemCount) =
            ResearchEscrow(escrow).settlementResult(SETTLEMENT_KEY);
        assert(recordedItemsHash == itemsHash);
        assert(recordedTotal == AMOUNT);
        assert(recordedItemCount == 1);
        assert(ResearchEscrow(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(ResearchEscrow(escrow).processedRequestKey(REQUEST_KEY));
        assert(ResearchEscrow(escrow).spent() == AMOUNT);
        assert(ResearchEscrow(escrow).accountedBalance() == BUDGET_UNITS - AMOUNT);
    }

    function _closeAndAssertReads(
        FactoryDeployment memory deployment,
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes32 itemsHash
    ) private {
        bytes32 resultDigest = CanonicalResearch.settlementResultDigest(SETTLEMENT_KEY, itemsHash, AMOUNT, 1);
        CanonicalResearch.LiabilityItem[] memory liabilities = _paidLiability(resultDigest);
        bytes32[] memory expectedRequestKeys = _singleExpectedRequestKey();
        bytes32 finalLiabilityHash =
            CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, AMOUNT);
        ResearchEscrowEip712.CloseAuthorization memory closeAuth =
            _closeAuthorization(escrow, voucher, 1, finalLiabilityHash, AMOUNT, 31, NOW_TS, NOW_TS + 5 minutes);

        VM.expectEmit(true, true, true, true, escrow);
        emit ResearchEscrowClosed(voucher.buyer, RESEARCH_KEY, finalLiabilityHash, 1, AMOUNT, BUDGET_UNITS - AMOUNT, 0);
        VM.prank(SETTLER);
        ResearchEscrow(escrow).close(liabilities, expectedRequestKeys, closeAuth, _signClose(escrow, closeAuth));

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(ResearchEscrow(escrow).closeReason() == 1);
        assert(ResearchEscrow(escrow).finalLiabilityHash() == finalLiabilityHash);
        assert(ResearchEscrow(escrow).budgetRefund() == BUDGET_UNITS - AMOUNT);
        assert(ResearchEscrow(escrow).excessRefund() == 0);
        assert(deployment.usdc.balanceOf(escrow) == 0);
    }

    function _deployPublishedFactory() private returns (FactoryDeployment memory deployment) {
        VM.etch(ARC_TESTNET_USDC, address(new MockUSDC()).code);
        deployment.usdc = MockUSDC(ARC_TESTNET_USDC);
        deployment.implementation = new ResearchEscrow();
        deployment.registry = new DataSourceRegistry(DEPLOYMENT_KEY);
        deployment.factory =
            new ResearchEscrowFactory(address(deployment.implementation), address(deployment.registry), DEPLOYMENT_KEY);

        VM.expectEmit(true, false, false, true, address(deployment.registry));
        emit FactoryBound(address(deployment.factory));
        VM.prank(DEPLOYMENT_KEY);
        deployment.registry.bindFactory(address(deployment.factory));

        _publishRoles(deployment);
        VM.warp(NOW_TS);
    }

    function _publishRoles(FactoryDeployment memory deployment) private {
        bytes32 factoryAdminRole = deployment.factory.DEFAULT_ADMIN_ROLE();
        bytes32 registryAdminRole = deployment.registry.DEFAULT_ADMIN_ROLE();
        bytes32 fundingSignerRole = deployment.factory.FUNDING_SIGNER_ROLE();
        bytes32 intentSignerRole = deployment.factory.INTENT_SIGNER_ROLE();
        bytes32 settlerRole = deployment.factory.SETTLER_ROLE();
        bytes32 sourceAdminRole = deployment.registry.SOURCE_ADMIN_ROLE();

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
    }

    function _fundedEscrow(address buyer, uint256 nonce)
        private
        returns (
            FactoryDeployment memory deployment,
            ResearchEscrowEip712.FundingVoucher memory voucher,
            address escrow
        )
    {
        deployment = _deployPublishedFactory();
        _configureSource(deployment.registry);
        voucher = _validFundingVoucher(deployment.factory, buyer, nonce);
        deployment.usdc.mint(buyer, BUDGET_UNITS);

        VM.prank(buyer);
        assert(deployment.usdc.approve(address(deployment.factory), BUDGET_UNITS));

        VM.prank(buyer);
        escrow = deployment.factory.createAndFund(voucher, _signFundingVoucher(deployment.factory, voucher));
    }

    function _fundedEscrowOnly(address buyer, uint256 nonce)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow)
    {
        (, voucher, escrow) = _fundedEscrow(buyer, nonce);
    }

    function _configureSource(DataSourceRegistry registry) private {
        VM.prank(SOURCE_ADMIN);
        registry.createSource(SOURCE_ID, PAYOUT, SOURCE_MAX_PRICE, true);
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

    function _settlementAuthorization(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes32 itemsHash,
        uint256 nonce
    ) private pure returns (ResearchEscrowEip712.SettlementAuthorization memory) {
        return ResearchEscrowEip712.SettlementAuthorization({
            escrow: escrow,
            researchKey: voucher.researchKey,
            settlementKey: SETTLEMENT_KEY,
            itemsHash: itemsHash,
            total: AMOUNT,
            itemCount: 1,
            nonce: nonce,
            issuedAt: NOW_TS,
            deadline: NOW_TS + 5 minutes
        });
    }

    function _closeAuthorization(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        uint8 closeReason,
        bytes32 finalLiabilityHash,
        uint256 spent,
        uint256 nonce,
        uint64 issuedAt,
        uint64 deadline
    ) private pure returns (ResearchEscrowEip712.CloseAuthorization memory) {
        return ResearchEscrowEip712.CloseAuthorization({
            escrow: escrow,
            researchKey: voucher.researchKey,
            closeReason: closeReason,
            finalLiabilityHash: finalLiabilityHash,
            spent: spent,
            nonce: nonce,
            issuedAt: issuedAt,
            deadline: deadline
        });
    }

    function _singleItem(address payout) private pure returns (CanonicalResearch.SettlementItem[] memory items) {
        items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY,
            sourceId: SOURCE_ID,
            registryRevision: 2,
            expectedPayout: payout,
            maxUnitPrice: SOURCE_MAX_PRICE,
            amount: AMOUNT
        });
    }

    function _paidLiability(bytes32 resultDigest)
        private
        pure
        returns (CanonicalResearch.LiabilityItem[] memory liabilities)
    {
        liabilities = new CanonicalResearch.LiabilityItem[](1);
        liabilities[0] = CanonicalResearch.LiabilityItem({
            requestKey: REQUEST_KEY,
            amount: AMOUNT,
            terminalState: 1,
            settlementKey: SETTLEMENT_KEY,
            terminalEvidenceHash: resultDigest
        });
    }

    function _singleExpectedRequestKey() private pure returns (bytes32[] memory expectedRequestKeys) {
        expectedRequestKeys = new bytes32[](1);
        expectedRequestKeys[0] = REQUEST_KEY;
    }

    function _assertFundedReads(
        FactoryDeployment memory deployment,
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher
    ) private view {
        assert(ResearchEscrow(escrow).factory() == address(deployment.factory));
        assert(ResearchEscrow(escrow).registry() == address(deployment.registry));
        assert(ResearchEscrow(escrow).usdc() == address(deployment.usdc));
        assert(ResearchEscrow(escrow).buyer() == voucher.buyer);
        assert(ResearchEscrow(escrow).researchKey() == voucher.researchKey);
        assert(ResearchEscrow(escrow).initialBudget() == voucher.budgetUnits);
        assert(ResearchEscrow(escrow).expectedExpiresAt() == voucher.expectedExpiresAt);
        assert(ResearchEscrow(escrow).activationCutoff() == voucher.fundingDeadline);
        assert(ResearchEscrow(escrow).plannedIntentSigner() == voucher.intentSigner);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
        assert(ResearchEscrow(escrow).spent() == 0);
        assert(ResearchEscrow(escrow).accountedBalance() == voucher.budgetUnits);
    }

    function _signFundingVoucher(ResearchEscrowFactory factory, ResearchEscrowEip712.FundingVoucher memory voucher)
        private
        returns (bytes memory)
    {
        bytes32 digest = ResearchEscrowEip712.fundingVoucherDigest(block.chainid, address(factory), voucher);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(FUNDING_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signActivation(address escrow, ResearchEscrowEip712.ActivationAuthorization memory authorization)
        private
        returns (bytes memory)
    {
        bytes32 digest = ResearchEscrowEip712.activationAuthorizationDigest(block.chainid, escrow, authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(BUYER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signSettlement(address escrow, ResearchEscrowEip712.SettlementAuthorization memory authorization)
        private
        returns (bytes memory)
    {
        bytes32 digest = ResearchEscrowEip712.settlementAuthorizationDigest(block.chainid, escrow, authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(INTENT_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signClose(address escrow, ResearchEscrowEip712.CloseAuthorization memory authorization)
        private
        returns (bytes memory)
    {
        bytes32 digest = ResearchEscrowEip712.closeAuthorizationDigest(block.chainid, escrow, authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(INTENT_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }
}
