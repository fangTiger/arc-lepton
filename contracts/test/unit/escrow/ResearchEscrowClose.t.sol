// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CanonicalResearch} from "../../../src/canonical/CanonicalResearch.sol";
import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";
import {IProjectRoleProbe, ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {MockUSDC} from "../../fixtures/tokens/MockUSDC.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface CloseVm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectPartialRevert(bytes4 revertData) external;
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

interface IResearchEscrowClose {
    error InvalidCloseAuthorization();
    error InvalidCloseAuthorizationWindow();
    error InvalidCloseSignature();
    error UnauthorizedSettler(address caller);
    error InvalidCloseSigner(address signer);
    error CloseNonceUsed(uint256 nonce);
    error EscrowNotExpired(uint256 currentTime, uint64 expectedExpiresAt);
    error NoRecoverableExcess();
    error PaidLiabilityNotSettled(bytes32 requestKey);
    error PaidLiabilityResultMismatch(bytes32 settlementKey);

    function activate(ResearchEscrowEip712.ActivationAuthorization calldata authorization, bytes calldata signature)
        external;

    function settleBatch(
        bytes32 settlementKey,
        CanonicalResearch.SettlementItem[] calldata items,
        ResearchEscrowEip712.SettlementAuthorization calldata authorization,
        bytes calldata signature
    ) external;

    function close(
        CanonicalResearch.LiabilityItem[] calldata liabilities,
        bytes32[] calldata expectedRequestKeys,
        ResearchEscrowEip712.CloseAuthorization calldata authorization,
        bytes calldata signature
    ) external;

    function closeReason() external view returns (uint8);
    function finalLiabilityHash() external view returns (bytes32);
    function closeNonceUsed(uint256 nonce) external view returns (bool);
    function budgetRefund() external view returns (uint256);
    function excessRefund() external view returns (uint256);
    function excessBalance() external view returns (uint256);
    function refundExpired() external;
    function recoverExcess() external;
}

contract ResearchEscrowCloseTest is RoleIsolationFixture {
    CloseVm private constant VM = CloseVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant REQUEST_KEY_1 = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 private constant REQUEST_KEY_2 = 0x2222222222222222222222222222222222222222222222222222222222222222;
    bytes32 private constant REQUEST_KEY_3 = 0x3333333333333333333333333333333333333333333333333333333333333333;
    bytes32 private constant SETTLEMENT_KEY = 0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7;
    bytes32 private constant OVER_BUDGET_SETTLEMENT_KEY =
        0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee;
    bytes32 private constant SOURCE_ID_1 = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;
    uint256 private constant BUDGET_UNITS = 1_000_000;
    uint256 private constant FIRST_AMOUNT = 100;
    uint256 private constant ARC_NATIVE_USDC_SCALE = 1_000_000_000_000;
    uint256 private constant EXCESS_UNITS = 12_345;
    uint256 private constant POST_CLOSE_EXCESS_UNITS = 7_654;
    uint64 private constant NOW_TS = 1_999_960_000;
    uint64 private constant FUNDING_DEADLINE = NOW_TS + 15 minutes;
    uint256 private constant BUYER_KEY = 0xB001;
    uint256 private constant FUNDING_SIGNER_KEY = 0xF001;
    uint256 private constant INTENT_SIGNER_KEY = 0x1A01;
    uint256 private constant WRONG_SIGNER_KEY = 0xBAD1;
    address private constant ANY_ACCOUNT = address(0xB0B);
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    struct FactoryDeployment {
        ResearchEscrow implementation;
        DataSourceRegistry registry;
        ResearchEscrowFactory factory;
        MockUSDC usdc;
    }

    struct LocalArcDualInterfaceWitness {
        address from;
        address to;
        uint256 erc20Units6;
        uint256 nativeUnits18;
        uint256 dedupedLogicalUnits6;
    }

    function testSignedCloseWithEmptyLiabilitiesRefundsBudgetAndRecordsReason() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 1, liabilityHash, 0, 201, NOW_TS, NOW_TS + 5 minutes);

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(IResearchEscrowClose(escrow).closeReason() == 1);
        assert(IResearchEscrowClose(escrow).finalLiabilityHash() == liabilityHash);
        assert(IResearchEscrowClose(escrow).closeNonceUsed(201));
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS);
    }

    function testSignedCloseWithPaidLiabilityRequiresRecordedSettlementResultAndRefundsRemainder() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        bytes32 itemsHash = _settleSingleItem(escrow, voucher, 301);
        bytes32 resultDigest = CanonicalResearch.settlementResultDigest(SETTLEMENT_KEY, itemsHash, FIRST_AMOUNT, 1);
        CanonicalResearch.LiabilityItem[] memory liabilities = _singlePaidLiability(resultDigest);
        bytes32[] memory expectedRequestKeys = _singleExpectedRequestKey();
        bytes32 liabilityHash =
            CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, FIRST_AMOUNT);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 1, liabilityHash, FIRST_AMOUNT, 202, NOW_TS, NOW_TS + 5 minutes);

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(IResearchEscrowClose(escrow).closeReason() == 1);
        assert(IResearchEscrowClose(escrow).finalLiabilityHash() == liabilityHash);
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS - FIRST_AMOUNT);
    }

    function testLocalArcSmokeHarnessExecutesFullLifecycleAndMatchesEvidence() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer);

        _assertFundedSmokeEvidence(deployment, buyer, escrow);
        _activateSmoke(escrow, voucher);
        bytes32 itemsHash = _settleSmoke(deployment.usdc, escrow, voucher);
        _closeSmoke(deployment.usdc, buyer, escrow, voucher, itemsHash);
    }

    function testSignedCloseWithVoidAndManualLiabilitiesRefundsFullBudget() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = _voidAndManualLiabilities();
        bytes32[] memory expectedRequestKeys = _twoExpectedRequestKeys();
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 2, liabilityHash, 0, 203, NOW_TS, NOW_TS + 5 minutes);

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(IResearchEscrowClose(escrow).closeReason() == 2);
        assert(IResearchEscrowClose(escrow).finalLiabilityHash() == liabilityHash);
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS);
    }

    function testCanonicalLiabilityHashRejectsOmissionDuplicateUnknownStateAndSpentMismatch() public {
        CanonicalResearch.LiabilityItem[] memory liabilities = _voidAndManualLiabilities();
        bytes32[] memory missingRequest = _singleExpectedRequestKey();
        VM.expectPartialRevert(CanonicalResearch.MissingLiability.selector);
        this.callFinalLiabilityHashForRequests(liabilities, missingRequest, 0);

        bytes32[] memory duplicateExpected = _twoExpectedRequestKeys();
        duplicateExpected[1] = REQUEST_KEY_1;
        VM.expectPartialRevert(CanonicalResearch.UnsortedKeys.selector);
        this.callFinalLiabilityHashForRequests(liabilities, duplicateExpected, 0);

        liabilities = _voidAndManualLiabilities();
        liabilities[1].terminalState = 99;
        VM.expectPartialRevert(CanonicalResearch.InvalidTerminalState.selector);
        this.callFinalLiabilityHashForRequests(liabilities, _twoExpectedRequestKeys(), 0);

        bytes32 resultDigest = CanonicalResearch.settlementResultDigest(SETTLEMENT_KEY, bytes32(uint256(1)), 1, 1);
        liabilities = _singlePaidLiability(resultDigest);
        VM.expectPartialRevert(CanonicalResearch.SpentMismatch.selector);
        this.callFinalLiabilityHashForRequests(liabilities, _singleExpectedRequestKey(), FIRST_AMOUNT + 1);
    }

    function testRejectsPaidLiabilityThatWasNotSettled() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        bytes32 resultDigest = CanonicalResearch.settlementResultDigest(SETTLEMENT_KEY, bytes32(uint256(1)), 1, 1);
        CanonicalResearch.LiabilityItem[] memory liabilities = _singlePaidLiability(resultDigest);
        bytes32[] memory expectedRequestKeys = _singleExpectedRequestKey();
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, FIRST_AMOUNT, 204);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.PaidLiabilityNotSettled.selector,
            SETTLER
        );
    }

    function testRejectsPaidLiabilityWithWrongSettlementResultDigest() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        _settleSingleItem(escrow, voucher, 302);
        CanonicalResearch.LiabilityItem[] memory liabilities = _singlePaidLiability(keccak256("wrong-result-digest"));
        bytes32[] memory expectedRequestKeys = _singleExpectedRequestKey();
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, FIRST_AMOUNT, 205);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.PaidLiabilityResultMismatch.selector,
            SETTLER
        );
    }

    function testRejectsZeroFinalLiabilityHash() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 1, bytes32(0), 0, 206, NOW_TS, NOW_TS + 5 minutes);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseAuthorization.selector,
            SETTLER
        );
    }

    function testRejectsCloseAuthorizationSpentThatDoesNotMatchLiabilities() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 1, liabilityHash, 1, 207, NOW_TS, NOW_TS + 5 minutes);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseAuthorization.selector,
            SETTLER
        );
    }

    function testRejectsCloseReasonOutsideAllowedRangeOnChain() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 4, liabilityHash, 0, 208, NOW_TS, NOW_TS + 5 minutes);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            hex"00",
            ResearchEscrowEip712.InvalidCloseReason.selector,
            SETTLER
        );
    }

    function testRejectsCloseAuthorizationWindowViolations() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 1, liabilityHash, 0, 209, NOW_TS + 1, NOW_TS + 5 minutes);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseAuthorizationWindow.selector,
            SETTLER
        );
    }

    function testRejectsCloseAuthorizationLifetimeLongerThanFiveMinutes() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 1, liabilityHash, 0, 210, NOW_TS, NOW_TS + 5 minutes + 1);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseAuthorizationWindow.selector,
            SETTLER
        );
    }

    function testRejectsCloseAuthorizationDeadlineAfterEscrowExpiry() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        uint64 issuedAt = voucher.expectedExpiresAt - 4 minutes;
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 1, liabilityHash, 0, 211, issuedAt, voucher.expectedExpiresAt + 1);

        VM.warp(uint256(issuedAt) + 1 minutes);
        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseAuthorizationWindow.selector,
            SETTLER
        );
    }

    function testRejectsTamperedCloseNonceSignature() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 212);
        bytes memory signature = _signCloseAuthorization(escrow, authorization);
        authorization.nonce = 213;

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            signature,
            IResearchEscrowClose.InvalidCloseSignature.selector,
            SETTLER
        );
    }

    function testRejectsWrongCloseSignature() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 214);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorizationWithKey(escrow, authorization, WRONG_SIGNER_KEY),
            IResearchEscrowClose.InvalidCloseSignature.selector,
            SETTLER
        );
    }

    function testRejectsIntentSignerRoleDrift() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 215);

        bytes32 intentSignerRole = deployment.factory.INTENT_SIGNER_ROLE();
        VM.prank(FACTORY_ADMIN);
        deployment.factory.revokeRole(intentSignerRole, voucher.intentSigner);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseSigner.selector,
            SETTLER
        );
    }

    function testRejectsUnauthorizedSettlerAndBuyerDirectEarlyClose() public {
        address buyer = VM.addr(BUYER_KEY);
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 216);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.UnauthorizedSettler.selector,
            buyer
        );
    }

    function testRejectsCloseWhenIntentSignerIsSettlerCaller() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 226);
        bytes32 settlerRole = deployment.factory.SETTLER_ROLE();
        address intentSigner = voucher.intentSigner;
        bytes memory hasSettlerRole = abi.encodeCall(IProjectRoleProbe.hasRole, (settlerRole, intentSigner));
        VM.mockCall(address(deployment.factory), hasSettlerRole, abi.encode(true));

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseSigner.selector,
            intentSigner
        );

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
        assert(!IResearchEscrowClose(escrow).closeNonceUsed(226));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(buyer) == 0);
    }

    function testRejectsCloseWhenIntentSignerHasSensitiveFactoryRole() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 227);
        bytes32 adminRole = deployment.factory.DEFAULT_ADMIN_ROLE();
        address intentSigner = voucher.intentSigner;
        bytes memory hasAdminRole = abi.encodeCall(IProjectRoleProbe.hasRole, (adminRole, intentSigner));
        VM.mockCall(address(deployment.factory), hasAdminRole, abi.encode(true));

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseSigner.selector,
            SETTLER
        );

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
        assert(!IResearchEscrowClose(escrow).closeNonceUsed(227));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(buyer) == 0);
    }

    function testRejectsCloseWhenIntentSignerHasSensitiveRegistryRole() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 228);
        bytes32 sourceAdminRole = deployment.registry.SOURCE_ADMIN_ROLE();
        address intentSigner = voucher.intentSigner;
        bytes memory hasSourceAdminRole = abi.encodeCall(IProjectRoleProbe.hasRole, (sourceAdminRole, intentSigner));
        VM.mockCall(address(deployment.registry), hasSourceAdminRole, abi.encode(true));

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.InvalidCloseSigner.selector,
            SETTLER
        );

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
        assert(!IResearchEscrowClose(escrow).closeNonceUsed(228));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(buyer) == 0);
    }

    function testRejectsFundedStateAndCloseReplay() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 217);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            ResearchEscrow.InvalidState.selector,
            SETTLER
        );

        ResearchEscrowEip712.ActivationAuthorization memory activation =
            _validActivation(escrow, voucher, 1, NOW_TS + 10 minutes);
        VM.prank(SETTLER);
        IResearchEscrowClose(escrow).activate(activation, _signActivation(escrow, activation, BUYER_KEY));

        authorization = _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 218);
        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorization(escrow, authorization),
            IResearchEscrowClose.CloseNonceUsed.selector,
            SETTLER
        );

        assert(deployment.usdc.balanceOf(escrow) == 0);
    }

    function testAnyAccountCanTriggerExpiredRefundButOnlyBuyerReceivesFunds() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);

        VM.warp(voucher.expectedExpiresAt);
        VM.prank(ANY_ACCOUNT);
        IResearchEscrowClose(escrow).refundExpired();

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(ANY_ACCOUNT) == 0);
    }

    function testRejectsExpiredRefundBeforeExpectedExpiresAt() public {
        (ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _activeEscrowOnly(VM.addr(BUYER_KEY));

        VM.warp(voucher.expectedExpiresAt - 1);
        VM.expectPartialRevert(IResearchEscrowClose.EscrowNotExpired.selector);
        VM.prank(ANY_ACCOUNT);
        IResearchEscrowClose(escrow).refundExpired();
    }

    function testCloseSignatureFailureDoesNotConsumeNonceAndCanRetry() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, 0, 219);

        _expectCloseRevert(
            escrow,
            liabilities,
            expectedRequestKeys,
            authorization,
            _signCloseAuthorizationWithKey(escrow, authorization, WRONG_SIGNER_KEY),
            IResearchEscrowClose.InvalidCloseSignature.selector,
            SETTLER
        );
        assert(!IResearchEscrowClose(escrow).closeNonceUsed(219));

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(IResearchEscrowClose(escrow).closeNonceUsed(219));
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS);
    }

    function testCreationPauseDoesNotBlockExistingSignedSettlementCloseOrExpiredRefund() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);

        VM.prank(FACTORY_ADMIN);
        deployment.factory.pauseCreation();

        _settleSingleItem(escrow, voucher, 303);
        assert(deployment.usdc.balanceOf(PAYOUT) == FIRST_AMOUNT);

        bytes32 resultDigest = CanonicalResearch.settlementResultDigest(
            SETTLEMENT_KEY, CanonicalResearch.itemsHash(_singleSettlementItem()), FIRST_AMOUNT, 1
        );
        CanonicalResearch.LiabilityItem[] memory liabilities = _singlePaidLiability(resultDigest);
        bytes32[] memory expectedRequestKeys = _singleExpectedRequestKey();
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, FIRST_AMOUNT, 220);

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS - FIRST_AMOUNT);
    }

    function testCreationPauseDoesNotBlockExpiredRefund() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);

        VM.prank(FACTORY_ADMIN);
        deployment.factory.pauseCreation();

        VM.warp(voucher.expectedExpiresAt);
        VM.prank(ANY_ACCOUNT);
        IResearchEscrowClose(escrow).refundExpired();

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS);
    }

    function testDirectTransferIsExcessAndDoesNotIncreaseSettlementBudget() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        _transferExcessToEscrow(deployment.usdc, escrow, EXCESS_UNITS);

        assert(ResearchEscrow(escrow).accountedBalance() == BUDGET_UNITS);
        assert(IResearchEscrowClose(escrow).excessBalance() == EXCESS_UNITS);
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS + EXCESS_UNITS);

        _configureSourceMax(deployment.registry, BUDGET_UNITS + 1);
        CanonicalResearch.SettlementItem[] memory items = _overBudgetSettlementItem();
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = ResearchEscrowEip712.SettlementAuthorization({
            escrow: escrow,
            researchKey: voucher.researchKey,
            settlementKey: OVER_BUDGET_SETTLEMENT_KEY,
            itemsHash: itemsHash,
            total: BUDGET_UNITS + 1,
            itemCount: 1,
            nonce: 401,
            issuedAt: NOW_TS,
            deadline: uint64(NOW_TS + 5 minutes)
        });

        VM.expectPartialRevert(ResearchEscrow.SettlementBudgetExceeded.selector);
        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .settleBatch(
                OVER_BUDGET_SETTLEMENT_KEY, items, authorization, _signSettlementAuthorization(escrow, authorization)
            );
    }

    function testCloseSeparatesBudgetRefundAndExcessRefundAndZerosBalance() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        _transferExcessToEscrow(deployment.usdc, escrow, EXCESS_UNITS);
        bytes32 itemsHash = _settleSingleItem(escrow, voucher, 402);
        bytes32 resultDigest = CanonicalResearch.settlementResultDigest(SETTLEMENT_KEY, itemsHash, FIRST_AMOUNT, 1);
        CanonicalResearch.LiabilityItem[] memory liabilities = _singlePaidLiability(resultDigest);
        bytes32[] memory expectedRequestKeys = _singleExpectedRequestKey();
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _signedCloseFor(escrow, voucher, liabilities, expectedRequestKeys, FIRST_AMOUNT, 403);

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));

        assert(IResearchEscrowClose(escrow).budgetRefund() == BUDGET_UNITS - FIRST_AMOUNT);
        assert(IResearchEscrowClose(escrow).excessRefund() == EXCESS_UNITS);
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS - FIRST_AMOUNT + EXCESS_UNITS);
        assert(deployment.usdc.balanceOf(ANY_ACCOUNT) == 0);
    }

    function testClosedAfterForcedTransferRecoverExcessOnlyBuyer() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _activeEscrow(buyer);
        bytes32 finalLiabilityHash = _closeWithEmptyLiabilities(escrow, voucher, 404);

        _transferExcessToEscrow(deployment.usdc, escrow, POST_CLOSE_EXCESS_UNITS);
        VM.prank(ANY_ACCOUNT);
        IResearchEscrowClose(escrow).recoverExcess();

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(IResearchEscrowClose(escrow).closeReason() == 1);
        assert(IResearchEscrowClose(escrow).finalLiabilityHash() == finalLiabilityHash);
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS + POST_CLOSE_EXCESS_UNITS);
        assert(deployment.usdc.balanceOf(ANY_ACCOUNT) == 0);
    }

    function testRejectsRecoverExcessBeforeClosed() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment,, address escrow) = _activeEscrow(buyer);
        _transferExcessToEscrow(deployment.usdc, escrow, EXCESS_UNITS);

        VM.expectPartialRevert(ResearchEscrow.InvalidState.selector);
        VM.prank(ANY_ACCOUNT);
        IResearchEscrowClose(escrow).recoverExcess();
    }

    function callFinalLiabilityHashForRequests(
        CanonicalResearch.LiabilityItem[] memory liabilities,
        bytes32[] memory expectedRequestKeys,
        uint256 spent
    ) external pure returns (bytes32) {
        return CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, spent);
    }

    function _localArcDualInterfaceWitness(address from, address to, uint256 units6)
        private
        pure
        returns (LocalArcDualInterfaceWitness memory)
    {
        return LocalArcDualInterfaceWitness({
            from: from,
            to: to,
            erc20Units6: units6,
            nativeUnits18: units6 * ARC_NATIVE_USDC_SCALE,
            dedupedLogicalUnits6: units6
        });
    }

    function _assertLocalArcDualInterfaceWitness(
        LocalArcDualInterfaceWitness memory witness,
        address expectedFrom,
        address expectedTo,
        uint256 expectedUnits6
    ) private pure {
        assert(witness.from == expectedFrom);
        assert(witness.to == expectedTo);
        assert(witness.erc20Units6 == expectedUnits6);
        assert(witness.nativeUnits18 == expectedUnits6 * ARC_NATIVE_USDC_SCALE);
        assert(witness.dedupedLogicalUnits6 == expectedUnits6);
    }

    function _assertFundedSmokeEvidence(FactoryDeployment memory deployment, address buyer, address escrow)
        private
        view
    {
        assert(deployment.factory.escrowOf(buyer, RESEARCH_KEY) == escrow);
        assert(ResearchEscrow(escrow).factory() == address(deployment.factory));
        assert(ResearchEscrow(escrow).registry() == address(deployment.registry));
        assert(ResearchEscrow(escrow).usdc() == ARC_TESTNET_USDC);
        assert(ResearchEscrow(escrow).buyer() == buyer);
        assert(ResearchEscrow(escrow).researchKey() == RESEARCH_KEY);
        assert(ResearchEscrow(escrow).initialBudget() == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(buyer) == 0);
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
        _assertLocalArcDualInterfaceWitness(
            _localArcDualInterfaceWitness(buyer, escrow, BUDGET_UNITS), buyer, escrow, BUDGET_UNITS
        );
        _assertLocalDirectEoaNativeFundingFormula(BUDGET_UNITS, 100_000, 1 gwei);
    }

    function _assertLocalDirectEoaNativeFundingFormula(uint256 budgetUnits6, uint256 gasUsed, uint256 effectiveGasPrice)
        private
        pure
    {
        uint256 gas18 = gasUsed * effectiveGasPrice;
        uint256 nativeBefore18 = budgetUnits6 * ARC_NATIVE_USDC_SCALE + gas18;
        uint256 nativeAfter18 = 0;

        assert(nativeBefore18 - nativeAfter18 - gas18 == budgetUnits6 * ARC_NATIVE_USDC_SCALE);
    }

    function _activateSmoke(address escrow, ResearchEscrowEip712.FundingVoucher memory voucher) private {
        ResearchEscrowEip712.ActivationAuthorization memory activation =
            _validActivation(escrow, voucher, 1, NOW_TS + 10 minutes);
        VM.prank(SETTLER);
        IResearchEscrowClose(escrow).activate(activation, _signActivation(escrow, activation, BUYER_KEY));
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
    }

    function _settleSmoke(MockUSDC usdc_, address escrow, ResearchEscrowEip712.FundingVoucher memory voucher)
        private
        returns (bytes32 itemsHash)
    {
        uint256 escrowBeforeSettlement = usdc_.balanceOf(escrow);
        uint256 payoutBeforeSettlement = usdc_.balanceOf(PAYOUT);
        itemsHash = _settleSingleItem(escrow, voucher, 301);
        assert(usdc_.balanceOf(escrow) == escrowBeforeSettlement - FIRST_AMOUNT);
        assert(usdc_.balanceOf(PAYOUT) == payoutBeforeSettlement + FIRST_AMOUNT);
        assert(ResearchEscrow(escrow).spent() == FIRST_AMOUNT);
        assert(ResearchEscrow(escrow).accountedBalance() == BUDGET_UNITS - FIRST_AMOUNT);

        (bytes32 recordedItemsHash, uint256 recordedTotal, uint32 recordedItemCount) =
            ResearchEscrow(escrow).settlementResult(SETTLEMENT_KEY);
        assert(recordedItemsHash == itemsHash);
        assert(recordedTotal == FIRST_AMOUNT);
        assert(recordedItemCount == 1);
        _assertLocalArcDualInterfaceWitness(
            _localArcDualInterfaceWitness(escrow, PAYOUT, FIRST_AMOUNT), escrow, PAYOUT, FIRST_AMOUNT
        );
    }

    function _closeSmoke(
        MockUSDC usdc_,
        address buyer,
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes32 itemsHash
    ) private {
        bytes32 resultDigest = CanonicalResearch.settlementResultDigest(SETTLEMENT_KEY, itemsHash, FIRST_AMOUNT, 1);
        CanonicalResearch.LiabilityItem[] memory liabilities = _singlePaidLiability(resultDigest);
        bytes32[] memory expectedRequestKeys = _singleExpectedRequestKey();
        bytes32 liabilityHash =
            CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, FIRST_AMOUNT);
        ResearchEscrowEip712.CloseAuthorization memory closeAuthorization =
            _closeAuthorization(escrow, voucher, 1, liabilityHash, FIRST_AMOUNT, 302, NOW_TS, NOW_TS + 5 minutes);

        uint256 buyerBeforeClose = usdc_.balanceOf(buyer);
        uint256 escrowBeforeClose = usdc_.balanceOf(escrow);
        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(
                liabilities,
                expectedRequestKeys,
                closeAuthorization,
                _signCloseAuthorization(escrow, closeAuthorization)
            );

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(IResearchEscrowClose(escrow).finalLiabilityHash() == liabilityHash);
        assert(IResearchEscrowClose(escrow).budgetRefund() == BUDGET_UNITS - FIRST_AMOUNT);
        assert(usdc_.balanceOf(escrow) == 0);
        assert(usdc_.balanceOf(buyer) == buyerBeforeClose + BUDGET_UNITS - FIRST_AMOUNT);
        assert(escrowBeforeClose == BUDGET_UNITS - FIRST_AMOUNT);
        _assertLocalArcDualInterfaceWitness(
            _localArcDualInterfaceWitness(escrow, buyer, BUDGET_UNITS - FIRST_AMOUNT),
            escrow,
            buyer,
            BUDGET_UNITS - FIRST_AMOUNT
        );
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

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow).activate(activation, _signActivation(escrow, activation, BUYER_KEY));
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
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
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
    }

    function _configureSourceMax(DataSourceRegistry registry, uint256 maxUnitPrice) private {
        VM.prank(SOURCE_ADMIN);
        registry.updateSource(SOURCE_ID_1, PAYOUT, maxUnitPrice, true);
    }

    function _transferExcessToEscrow(MockUSDC usdc_, address escrow, uint256 amount) private {
        usdc_.mint(ANY_ACCOUNT, amount);
        VM.prank(ANY_ACCOUNT);
        assert(usdc_.transfer(escrow, amount));
    }

    function _closeWithEmptyLiabilities(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        uint256 nonce
    ) private returns (bytes32 liabilityHash) {
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        ResearchEscrowEip712.CloseAuthorization memory authorization =
            _closeAuthorization(escrow, voucher, 1, liabilityHash, 0, nonce, NOW_TS, NOW_TS + 5 minutes);

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));
    }

    function _settleSingleItem(address escrow, ResearchEscrowEip712.FundingVoucher memory voucher, uint256 nonce)
        private
        returns (bytes32 itemsHash)
    {
        CanonicalResearch.SettlementItem[] memory items = _singleSettlementItem();
        itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = ResearchEscrowEip712.SettlementAuthorization({
            escrow: escrow,
            researchKey: voucher.researchKey,
            settlementKey: SETTLEMENT_KEY,
            itemsHash: itemsHash,
            total: FIRST_AMOUNT,
            itemCount: 1,
            nonce: nonce,
            issuedAt: NOW_TS,
            deadline: uint64(NOW_TS + 5 minutes)
        });

        VM.prank(SETTLER);
        IResearchEscrowClose(escrow)
            .settleBatch(SETTLEMENT_KEY, items, authorization, _signSettlementAuthorization(escrow, authorization));
    }

    function _singleSettlementItem() private pure returns (CanonicalResearch.SettlementItem[] memory items) {
        items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY_1,
            sourceId: SOURCE_ID_1,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: 1000,
            amount: FIRST_AMOUNT
        });
    }

    function _overBudgetSettlementItem() private pure returns (CanonicalResearch.SettlementItem[] memory items) {
        items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY_3,
            sourceId: SOURCE_ID_1,
            registryRevision: 2,
            expectedPayout: PAYOUT,
            maxUnitPrice: BUDGET_UNITS + 1,
            amount: BUDGET_UNITS + 1
        });
    }

    function _singlePaidLiability(bytes32 resultDigest)
        private
        pure
        returns (CanonicalResearch.LiabilityItem[] memory liabilities)
    {
        liabilities = new CanonicalResearch.LiabilityItem[](1);
        liabilities[0] = CanonicalResearch.LiabilityItem({
            requestKey: REQUEST_KEY_1,
            amount: FIRST_AMOUNT,
            terminalState: 1,
            settlementKey: SETTLEMENT_KEY,
            terminalEvidenceHash: resultDigest
        });
    }

    function _voidAndManualLiabilities() private pure returns (CanonicalResearch.LiabilityItem[] memory liabilities) {
        liabilities = new CanonicalResearch.LiabilityItem[](2);
        liabilities[0] = CanonicalResearch.LiabilityItem({
            requestKey: REQUEST_KEY_1,
            amount: 0,
            terminalState: 2,
            settlementKey: bytes32(0),
            terminalEvidenceHash: keccak256("void-before-side-effect")
        });
        liabilities[1] = CanonicalResearch.LiabilityItem({
            requestKey: REQUEST_KEY_2,
            amount: 0,
            terminalState: 3,
            settlementKey: bytes32(0),
            terminalEvidenceHash: keccak256("manual-unpayable")
        });
    }

    function _singleExpectedRequestKey() private pure returns (bytes32[] memory expectedRequestKeys) {
        expectedRequestKeys = new bytes32[](1);
        expectedRequestKeys[0] = REQUEST_KEY_1;
    }

    function _twoExpectedRequestKeys() private pure returns (bytes32[] memory expectedRequestKeys) {
        expectedRequestKeys = new bytes32[](2);
        expectedRequestKeys[0] = REQUEST_KEY_1;
        expectedRequestKeys[1] = REQUEST_KEY_2;
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

    function _signedCloseFor(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        CanonicalResearch.LiabilityItem[] memory liabilities,
        bytes32[] memory expectedRequestKeys,
        uint256 spent,
        uint256 nonce
    ) private pure returns (ResearchEscrowEip712.CloseAuthorization memory) {
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, spent);
        return _closeAuthorization(escrow, voucher, 1, liabilityHash, spent, nonce, NOW_TS, NOW_TS + 5 minutes);
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
        bytes32 digest = ResearchEscrowEip712.settlementAuthorizationDigest(block.chainid, escrow, authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(INTENT_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signCloseAuthorization(address escrow, ResearchEscrowEip712.CloseAuthorization memory authorization)
        private
        returns (bytes memory)
    {
        return _signCloseAuthorizationWithKey(escrow, authorization, INTENT_SIGNER_KEY);
    }

    function _signCloseAuthorizationWithKey(
        address escrow,
        ResearchEscrowEip712.CloseAuthorization memory authorization,
        uint256 privateKey
    ) private returns (bytes memory) {
        bytes32 digest = ResearchEscrowEip712.closeAuthorizationDigest(block.chainid, escrow, authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);

        return abi.encodePacked(r, s, v);
    }

    function _expectCloseRevert(
        address escrow,
        CanonicalResearch.LiabilityItem[] memory liabilities,
        bytes32[] memory expectedRequestKeys,
        ResearchEscrowEip712.CloseAuthorization memory authorization,
        bytes memory signature,
        bytes4 expectedSelector,
        address caller
    ) private {
        VM.expectPartialRevert(expectedSelector);
        VM.prank(caller);
        IResearchEscrowClose(escrow).close(liabilities, expectedRequestKeys, authorization, signature);
    }
}
