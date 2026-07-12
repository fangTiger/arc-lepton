// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CanonicalResearch} from "../../src/canonical/CanonicalResearch.sol";
import {ResearchEscrowEip712} from "../../src/canonical/ResearchEscrowEip712.sol";
import {ResearchEscrow} from "../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../src/factory/ResearchEscrowFactory.sol";
import {DataSourceRegistry} from "../../src/registry/DataSourceRegistry.sol";
import {FalseReturnToken} from "../fixtures/tokens/FalseReturnToken.sol";
import {FeeOnTransferToken} from "../fixtures/tokens/FeeOnTransferToken.sol";
import {MockUSDC} from "../fixtures/tokens/MockUSDC.sol";
import {ReentrantToken} from "../fixtures/tokens/ReentrantToken.sol";
import {RevertingToken} from "../fixtures/tokens/RevertingToken.sol";
import {RoleIsolationFixture} from "../fixtures/RoleIsolationFixture.sol";

interface InvariantVm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

interface IResearchEscrowInvariant {
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

    function refundExpired() external;
    function recoverExcess() external;
}

contract ResearchEscrowInvariantHandler is RoleIsolationFixture {
    InvariantVm private constant VM = InvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant SOURCE_ID = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;
    uint256 private constant BUDGET_UNITS = 1_000_000;
    uint64 private constant NOW_TS = 1_999_960_000;
    uint64 private constant FUNDING_DEADLINE = NOW_TS + 15 minutes;
    uint256 private constant BUYER_KEY = 0xB001;
    uint256 private constant FUNDING_SIGNER_KEY = 0xF001;
    uint256 private constant INTENT_SIGNER_KEY = 0x1A01;
    address private constant ANY_ACCOUNT = address(0xB0B);
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    ResearchEscrow public implementation;
    DataSourceRegistry public registry;
    ResearchEscrowFactory public factory;
    MockUSDC public usdc;
    ResearchEscrow public escrow;
    ResearchEscrowEip712.FundingVoucher private voucher;

    uint256 public expectedSpent;
    uint256 public successfulSettlements;
    uint256 public lastSettlementAmount;
    bytes32 public lastSettlementKey;
    bytes32 public lastRequestKey;
    bool public roleDrifted;
    bool public creationPaused;

    constructor() {
        address buyerAccount = VM.addr(BUYER_KEY);
        VM.etch(ARC_TESTNET_USDC, address(new MockUSDC()).code);
        usdc = MockUSDC(ARC_TESTNET_USDC);
        implementation = new ResearchEscrow();
        registry = new DataSourceRegistry(DEPLOYMENT_KEY);
        factory = new ResearchEscrowFactory(address(implementation), address(registry), DEPLOYMENT_KEY);

        bytes32 factoryAdminRole = factory.DEFAULT_ADMIN_ROLE();
        bytes32 registryAdminRole = registry.DEFAULT_ADMIN_ROLE();
        bytes32 fundingSignerRole = factory.FUNDING_SIGNER_ROLE();
        bytes32 intentSignerRole = factory.INTENT_SIGNER_ROLE();
        bytes32 settlerRole = factory.SETTLER_ROLE();
        bytes32 sourceAdminRole = registry.SOURCE_ADMIN_ROLE();

        VM.prank(DEPLOYMENT_KEY);
        registry.bindFactory(address(factory));

        VM.prank(DEPLOYMENT_KEY);
        factory.grantRole(factoryAdminRole, FACTORY_ADMIN);
        VM.prank(DEPLOYMENT_KEY);
        registry.grantRole(registryAdminRole, REGISTRY_ADMIN);
        VM.prank(DEPLOYMENT_KEY);
        factory.grantRole(fundingSignerRole, VM.addr(FUNDING_SIGNER_KEY));
        VM.prank(DEPLOYMENT_KEY);
        factory.grantRole(intentSignerRole, VM.addr(INTENT_SIGNER_KEY));
        VM.prank(DEPLOYMENT_KEY);
        factory.grantRole(settlerRole, SETTLER);
        VM.prank(REGISTRY_ADMIN);
        registry.grantRole(sourceAdminRole, SOURCE_ADMIN);

        VM.prank(FACTORY_ADMIN);
        factory.revokeRole(factoryAdminRole, DEPLOYMENT_KEY);
        VM.prank(REGISTRY_ADMIN);
        registry.revokeRole(registryAdminRole, DEPLOYMENT_KEY);

        VM.prank(SOURCE_ADMIN);
        registry.createSource(SOURCE_ID, PAYOUT, BUDGET_UNITS + 1, true);

        voucher = ResearchEscrowEip712.FundingVoucher({
            buyer: buyerAccount,
            researchKey: RESEARCH_KEY,
            budgetUnits: BUDGET_UNITS,
            expectedExpiresAt: uint64(NOW_TS + factory.MIN_ESCROW_TTL()),
            fundingDeadline: FUNDING_DEADLINE,
            intentSigner: VM.addr(INTENT_SIGNER_KEY),
            voucherNonce: 1
        });

        VM.warp(NOW_TS);
        usdc.mint(buyerAccount, BUDGET_UNITS);
        VM.prank(buyerAccount);
        assert(usdc.approve(address(factory), BUDGET_UNITS));
        VM.prank(buyerAccount);
        escrow = ResearchEscrow(factory.createAndFund(voucher, _signFundingVoucher(voucher)));

        ResearchEscrowEip712.ActivationAuthorization memory activation = ResearchEscrowEip712.ActivationAuthorization({
            escrow: address(escrow),
            researchKey: RESEARCH_KEY,
            buyer: buyerAccount,
            intentSigner: voucher.intentSigner,
            initialBudget: BUDGET_UNITS,
            expectedExpiresAt: voucher.expectedExpiresAt,
            activationNonce: 1,
            deadline: NOW_TS + 10 minutes
        });
        VM.prank(SETTLER);
        IResearchEscrowInvariant(address(escrow)).activate(activation, _signActivation(activation));
    }

    function initialBudget() public pure returns (uint256) {
        return BUDGET_UNITS;
    }

    function buyer() public returns (address) {
        return VM.addr(BUYER_KEY);
    }

    function depositExcess(uint96 amountSeed) public {
        uint256 amount = uint256(amountSeed) % 10_000 + 1;
        usdc.mint(ANY_ACCOUNT, amount);
        VM.prank(ANY_ACCOUNT);
        assert(usdc.transfer(address(escrow), amount));
    }

    function settleWithinBudget(uint96 amountSeed) public {
        if (escrow.state() != ResearchEscrow.EscrowState.Active || roleDrifted) {
            return;
        }
        if (block.timestamp + 5 minutes > voucher.expectedExpiresAt) {
            return;
        }

        uint256 remaining = BUDGET_UNITS - escrow.spent();
        if (remaining == 0) {
            return;
        }

        uint256 amount = uint256(amountSeed) % remaining + 1;
        bytes32 settlementKey = keccak256(abi.encode("settlement", successfulSettlements + 1));
        bytes32 requestKey = keccak256(abi.encode("request", successfulSettlements + 1));
        _attemptSettlement(settlementKey, requestKey, amount, true);
    }

    function replayLastSettlement() public {
        if (lastSettlementKey == bytes32(0) || escrow.state() != ResearchEscrow.EscrowState.Active) {
            return;
        }

        _attemptSettlement(lastSettlementKey, lastRequestKey, lastSettlementAmount, false);
    }

    function driftIntentSignerRole() public {
        if (escrow.state() != ResearchEscrow.EscrowState.Active || roleDrifted) {
            return;
        }
        if (block.timestamp + 5 minutes > voucher.expectedExpiresAt) {
            return;
        }

        bytes32 intentSignerRole = factory.INTENT_SIGNER_ROLE();
        VM.prank(FACTORY_ADMIN);
        factory.revokeRole(intentSignerRole, voucher.intentSigner);
        roleDrifted = true;

        if (escrow.spent() == BUDGET_UNITS) {
            return;
        }

        _attemptSettlement(keccak256("role-drift-settlement"), keccak256("role-drift-request"), 1, false);
    }

    function tryOverBudgetSettlementAfterExcess(uint96 excessSeed) public {
        if (escrow.state() != ResearchEscrow.EscrowState.Active || roleDrifted) {
            return;
        }

        depositExcess(excessSeed);
        _attemptSettlement(
            keccak256("over-budget-settlement"), keccak256("over-budget-request"), BUDGET_UNITS + 1, false
        );
    }

    function closeEmptyIfNoSpend(uint8 reasonSeed) public {
        if (escrow.state() != ResearchEscrow.EscrowState.Active || escrow.spent() != 0 || roleDrifted) {
            return;
        }
        if (block.timestamp + 5 minutes > voucher.expectedExpiresAt) {
            return;
        }

        uint8 reason = uint8(reasonSeed % 3) + 1;
        CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
        bytes32[] memory expectedRequestKeys = new bytes32[](0);
        bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
        ResearchEscrowEip712.CloseAuthorization memory authorization = ResearchEscrowEip712.CloseAuthorization({
            escrow: address(escrow),
            researchKey: RESEARCH_KEY,
            closeReason: reason,
            finalLiabilityHash: liabilityHash,
            spent: 0,
            nonce: 10_000 + successfulSettlements,
            issuedAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 5 minutes)
        });

        VM.prank(SETTLER);
        (bool ok,) = address(escrow)
            .call(
                abi.encodeCall(
                    IResearchEscrowInvariant.close,
                    (liabilities, expectedRequestKeys, authorization, _signClose(authorization))
                )
            );
        assert(ok);
    }

    function expireAndRefund(uint32 secondsAfter) public {
        if (escrow.state() == ResearchEscrow.EscrowState.Closed) {
            return;
        }

        VM.warp(uint256(voucher.expectedExpiresAt) + (uint256(secondsAfter) % 1 days));
        VM.prank(ANY_ACCOUNT);
        (bool ok,) = address(escrow).call(abi.encodeCall(IResearchEscrowInvariant.refundExpired, ()));
        assert(ok);
    }

    function recoverClosedExcess(uint96 amountSeed) public {
        if (escrow.state() != ResearchEscrow.EscrowState.Closed) {
            return;
        }

        uint256 amount = uint256(amountSeed) % 10_000 + 1;
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        usdc.mint(ANY_ACCOUNT, amount);
        VM.prank(ANY_ACCOUNT);
        assert(usdc.transfer(address(escrow), amount));
        uint256 callerBefore = usdc.balanceOf(ANY_ACCOUNT);
        uint256 buyerBefore = usdc.balanceOf(buyer());

        VM.prank(ANY_ACCOUNT);
        (bool ok,) = address(escrow).call(abi.encodeCall(IResearchEscrowInvariant.recoverExcess, ()));
        assert(ok);
        assert(usdc.balanceOf(ANY_ACCOUNT) == callerBefore);
        assert(usdc.balanceOf(buyer()) == buyerBefore + escrowBefore + amount);
    }

    function unauthorizedSettlementDoesNotMoveFunds(uint96 amountSeed) public {
        if (escrow.state() != ResearchEscrow.EscrowState.Active) {
            return;
        }

        uint256 remaining = BUDGET_UNITS - escrow.spent();
        if (remaining == 0) {
            return;
        }
        uint256 amount = uint256(amountSeed) % remaining + 1;
        uint256 spentBefore = escrow.spent();
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        uint256 payoutBefore = usdc.balanceOf(PAYOUT);

        CanonicalResearch.SettlementItem[] memory items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: keccak256(abi.encode("unauthorized-request", amountSeed)),
            sourceId: SOURCE_ID,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: BUDGET_UNITS + 1,
            amount: amount
        });
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = ResearchEscrowEip712.SettlementAuthorization({
            escrow: address(escrow),
            researchKey: RESEARCH_KEY,
            settlementKey: keccak256(abi.encode("unauthorized-settlement", amountSeed)),
            itemsHash: itemsHash,
            total: amount,
            itemCount: 1,
            nonce: 900_000 + uint256(amountSeed),
            issuedAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 5 minutes)
        });

        VM.prank(ANY_ACCOUNT);
        (bool ok,) = address(escrow)
            .call(
                abi.encodeCall(
                    IResearchEscrowInvariant.settleBatch,
                    (authorization.settlementKey, items, authorization, _signSettlementAuthorization(authorization))
                )
            );
        assert(!ok);
        assert(escrow.spent() == spentBefore);
        assert(usdc.balanceOf(address(escrow)) == escrowBefore);
        assert(usdc.balanceOf(PAYOUT) == payoutBefore);
    }

    function pauseCreation() public {
        if (creationPaused) {
            return;
        }

        VM.prank(FACTORY_ADMIN);
        factory.pauseCreation();
        creationPaused = true;
    }

    function tryRefundBeforeExpiry(uint32 secondsBefore) public {
        if (escrow.state() == ResearchEscrow.EscrowState.Closed) {
            return;
        }

        uint256 offset = uint256(secondsBefore) % 1 hours + 1;
        VM.warp(uint256(voucher.expectedExpiresAt) - offset);
        uint256 balanceBefore = usdc.balanceOf(address(escrow));
        VM.prank(ANY_ACCOUNT);
        (bool ok,) = address(escrow).call(abi.encodeCall(IResearchEscrowInvariant.refundExpired, ()));
        assert(!ok);
        assert(escrow.state() != ResearchEscrow.EscrowState.Closed);
        assert(usdc.balanceOf(address(escrow)) == balanceBefore);
    }

    function adversarialTokenSettlementDoesNotConsumeState(uint8 tokenKindSeed, uint96 amountSeed) public {
        if (escrow.state() != ResearchEscrow.EscrowState.Active || roleDrifted) {
            return;
        }
        if (block.timestamp + 5 minutes > voucher.expectedExpiresAt) {
            return;
        }

        uint256 remaining = BUDGET_UNITS - escrow.spent();
        if (remaining == 0) {
            return;
        }

        uint8 tokenKind = tokenKindSeed % 4;
        uint256 amount = uint256(amountSeed) % remaining + 1;
        bytes32 settlementKey = keccak256(abi.encode("adversarial-settlement", tokenKind, amountSeed));
        bytes32 requestKey = keccak256(abi.encode("adversarial-request", tokenKind, amountSeed));

        CanonicalResearch.SettlementItem[] memory items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: requestKey,
            sourceId: SOURCE_ID,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: BUDGET_UNITS + 1,
            amount: amount
        });
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = ResearchEscrowEip712.SettlementAuthorization({
            escrow: address(escrow),
            researchKey: RESEARCH_KEY,
            settlementKey: settlementKey,
            itemsHash: itemsHash,
            total: amount,
            itemCount: 1,
            nonce: 800_000 + uint256(tokenKindSeed) * 100_000 + uint256(amountSeed),
            issuedAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 5 minutes)
        });
        bytes memory signature = _signSettlementAuthorization(authorization);

        uint256 spentBefore = escrow.spent();
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        uint256 payoutBefore = usdc.balanceOf(PAYOUT);

        _installAdversarialTokenRuntime(tokenKind);
        if (tokenKind == 3) {
            ReentrantToken(ARC_TESTNET_USDC)
                .configureCallback(
                    address(escrow),
                    abi.encodeCall(
                        IResearchEscrowInvariant.settleBatch, (settlementKey, items, authorization, signature)
                    )
                );
        }

        VM.prank(SETTLER);
        (bool ok,) = address(escrow)
            .call(
                abi.encodeCall(IResearchEscrowInvariant.settleBatch, (settlementKey, items, authorization, signature))
            );

        assert(!ok);
        assert(escrow.spent() == spentBefore);
        assert(!escrow.processedSettlementKey(settlementKey));
        assert(!escrow.processedRequestKey(requestKey));
        assert(usdc.balanceOf(address(escrow)) == escrowBefore);
        assert(usdc.balanceOf(PAYOUT) == payoutBefore);

        VM.etch(ARC_TESTNET_USDC, address(new MockUSDC()).code);
    }

    function _attemptSettlement(bytes32 settlementKey, bytes32 requestKey, uint256 amount, bool expectSuccess) private {
        uint256 spentBefore = escrow.spent();
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        uint256 payoutBefore = usdc.balanceOf(PAYOUT);

        CanonicalResearch.SettlementItem[] memory items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: requestKey,
            sourceId: SOURCE_ID,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: BUDGET_UNITS + 1,
            amount: amount
        });
        bytes32 itemsHash = CanonicalResearch.itemsHash(items);
        ResearchEscrowEip712.SettlementAuthorization memory authorization = ResearchEscrowEip712.SettlementAuthorization({
            escrow: address(escrow),
            researchKey: RESEARCH_KEY,
            settlementKey: settlementKey,
            itemsHash: itemsHash,
            total: amount,
            itemCount: 1,
            nonce: successfulSettlements + 1,
            issuedAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 5 minutes)
        });

        VM.prank(SETTLER);
        (bool ok,) = address(escrow)
            .call(
                abi.encodeCall(
                    IResearchEscrowInvariant.settleBatch,
                    (settlementKey, items, authorization, _signSettlementAuthorization(authorization))
                )
            );

        if (expectSuccess) {
            assert(ok);
            expectedSpent += amount;
            successfulSettlements += 1;
            lastSettlementAmount = amount;
            lastSettlementKey = settlementKey;
            lastRequestKey = requestKey;
            assert(escrow.spent() == spentBefore + amount);
            assert(usdc.balanceOf(address(escrow)) == escrowBefore - amount);
            assert(usdc.balanceOf(PAYOUT) == payoutBefore + amount);
        } else {
            assert(!ok);
            assert(escrow.spent() == spentBefore);
            assert(usdc.balanceOf(address(escrow)) == escrowBefore);
            assert(usdc.balanceOf(PAYOUT) == payoutBefore);
        }
    }

    function _installAdversarialTokenRuntime(uint8 tokenKind) private {
        if (tokenKind == 0) {
            VM.etch(ARC_TESTNET_USDC, address(new FeeOnTransferToken()).code);
        } else if (tokenKind == 1) {
            VM.etch(ARC_TESTNET_USDC, address(new FalseReturnToken()).code);
        } else if (tokenKind == 2) {
            VM.etch(ARC_TESTNET_USDC, address(new RevertingToken()).code);
        } else {
            VM.etch(ARC_TESTNET_USDC, address(new ReentrantToken()).code);
        }
    }

    function _signFundingVoucher(ResearchEscrowEip712.FundingVoucher memory fundingVoucher)
        private
        returns (bytes memory)
    {
        bytes32 digest = ResearchEscrowEip712.fundingVoucherDigest(block.chainid, address(factory), fundingVoucher);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(FUNDING_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signActivation(ResearchEscrowEip712.ActivationAuthorization memory authorization)
        private
        returns (bytes memory)
    {
        bytes32 digest =
            ResearchEscrowEip712.activationAuthorizationDigest(block.chainid, address(escrow), authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(BUYER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signSettlementAuthorization(ResearchEscrowEip712.SettlementAuthorization memory authorization)
        private
        returns (bytes memory)
    {
        bytes32 digest =
            ResearchEscrowEip712.settlementAuthorizationDigest(block.chainid, address(escrow), authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(INTENT_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _signClose(ResearchEscrowEip712.CloseAuthorization memory authorization) private returns (bytes memory) {
        bytes32 digest = ResearchEscrowEip712.closeAuthorizationDigest(block.chainid, address(escrow), authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(INTENT_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }
}

contract ResearchEscrowInvariantsTest {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    ResearchEscrowInvariantHandler private handler;

    function setUp() public {
        handler = new ResearchEscrowInvariantHandler();
    }

    function testFuzzDirectExcessDoesNotFundOverBudgetSettlement(uint96 excessSeed) public {
        handler.tryOverBudgetSettlementAfterExcess(excessSeed);

        ResearchEscrow escrow = handler.escrow();
        assert(escrow.spent() == 0);
        assert(escrow.accountedBalance() == handler.initialBudget());
        assert(handler.usdc().balanceOf(address(escrow)) > handler.initialBudget());
    }

    function testFuzzExpiredRefundBoundary(uint32 secondsBefore, uint32 secondsAfter) public {
        handler.tryRefundBeforeExpiry(secondsBefore);
        assert(handler.escrow().state() == ResearchEscrow.EscrowState.Active);

        handler.expireAndRefund(secondsAfter);
        assert(handler.escrow().state() == ResearchEscrow.EscrowState.Closed);
        assert(handler.usdc().balanceOf(address(handler.escrow())) == 0);
    }

    function testFuzzAdversarialTokenSettlementDoesNotConsumeState(uint8 tokenKind, uint96 amountSeed) public {
        handler.adversarialTokenSettlementDoesNotConsumeState(tokenKind, amountSeed);

        assert(handler.escrow().state() == ResearchEscrow.EscrowState.Active);
        assert(handler.escrow().spent() == 0);
        assert(handler.escrow().accountedBalance() == handler.initialBudget());
        assert(handler.usdc().balanceOf(address(handler.escrow())) == handler.initialBudget());
    }

    function invariant_spentNeverExceedsInitialBudget() public view {
        assert(handler.escrow().spent() <= handler.initialBudget());
    }

    function invariant_accountedBalanceMatchesSpent() public view {
        assert(handler.escrow().accountedBalance() == handler.initialBudget() - handler.escrow().spent());
    }

    function invariant_nonClosedBalanceCoversAccountedBalance() public view {
        if (handler.escrow().state() == ResearchEscrow.EscrowState.Closed) {
            return;
        }

        assert(handler.usdc().balanceOf(address(handler.escrow())) >= handler.escrow().accountedBalance());
    }

    function invariant_closedBalanceIsRecoverableExcess() public view {
        if (handler.escrow().state() != ResearchEscrow.EscrowState.Closed) {
            return;
        }

        assert(handler.escrow().excessBalance() == handler.usdc().balanceOf(address(handler.escrow())));
    }

    function invariant_handlerSpentMatchesContractSpent() public view {
        assert(handler.expectedSpent() == handler.escrow().spent());
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() public view returns (FuzzSelector[] memory selectors) {
        selectors = new FuzzSelector[](1);
        selectors[0].addr = address(handler);
        selectors[0].selectors = new bytes4[](10);
        selectors[0].selectors[0] = ResearchEscrowInvariantHandler.depositExcess.selector;
        selectors[0].selectors[1] = ResearchEscrowInvariantHandler.settleWithinBudget.selector;
        selectors[0].selectors[2] = ResearchEscrowInvariantHandler.replayLastSettlement.selector;
        selectors[0].selectors[3] = ResearchEscrowInvariantHandler.driftIntentSignerRole.selector;
        selectors[0].selectors[4] = ResearchEscrowInvariantHandler.closeEmptyIfNoSpend.selector;
        selectors[0].selectors[5] = ResearchEscrowInvariantHandler.expireAndRefund.selector;
        selectors[0].selectors[6] = ResearchEscrowInvariantHandler.recoverClosedExcess.selector;
        selectors[0].selectors[7] = ResearchEscrowInvariantHandler.unauthorizedSettlementDoesNotMoveFunds.selector;
        selectors[0].selectors[8] = ResearchEscrowInvariantHandler.pauseCreation.selector;
        selectors[0].selectors[9] = ResearchEscrowInvariantHandler.tryRefundBeforeExpiry.selector;
    }

    function excludeContracts() public pure returns (address[] memory) {
        return new address[](0);
    }

    function targetSenders() public pure returns (address[] memory) {
        return new address[](0);
    }

    function excludeSenders() public pure returns (address[] memory) {
        return new address[](0);
    }

    function targetArtifacts() public pure returns (string[] memory) {
        return new string[](0);
    }

    function excludeArtifacts() public pure returns (string[] memory) {
        return new string[](0);
    }

    function excludeSelectors() public pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function targetArtifactSelectors() public pure returns (FuzzArtifactSelector[] memory) {
        return new FuzzArtifactSelector[](0);
    }

    function targetInterfaces() public pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }
}
