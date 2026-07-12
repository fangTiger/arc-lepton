// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CanonicalResearch} from "../../../src/canonical/CanonicalResearch.sol";
import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";
import {ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {MockUSDC} from "../../fixtures/tokens/MockUSDC.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface ActivationVm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

interface IResearchEscrowActivation {
    function activate(ResearchEscrowEip712.ActivationAuthorization calldata authorization, bytes calldata signature)
        external;

    function cancelUnactivated() external;
    function activeIntentSigner() external view returns (address);
    function activationNonceUsed(uint256 nonce) external view returns (bool);
}

interface IResearchEscrowFundedGuards {
    function spent() external view returns (uint256);
    function accountedBalance() external view returns (uint256);
    function processedRequestKey(bytes32 requestKey) external view returns (bool);
    function processedSettlementKey(bytes32 settlementKey) external view returns (bool);

    function settleBatch(
        bytes32 settlementKey,
        CanonicalResearch.SettlementItem[] calldata items,
        ResearchEscrowEip712.SettlementAuthorization calldata authorization,
        bytes calldata signature
    ) external;

    function close(ResearchEscrowEip712.CloseAuthorization calldata authorization, bytes calldata signature) external;
}

contract ResearchEscrowActivationTest is RoleIsolationFixture {
    ActivationVm private constant VM = ActivationVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant ERC1271_RESEARCH_KEY = 0x441d6a661b4d4d6d475d860d69db5d195e83987c4b8f8209b9bb841bb6ce3d32;
    bytes32 private constant REQUEST_KEY = 0xbb469196cc6b5028360740da10f0e57e763db8971c37fe1a04515283233e32ab;
    bytes32 private constant SETTLEMENT_KEY = 0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7;
    bytes32 private constant SOURCE_ID = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;
    bytes32 private constant ITEMS_HASH = 0x97180eb3603765a7d6b345f882b2e54df6caa90acf6f2a372b7b2197fbd707ea;
    bytes32 private constant FINAL_LIABILITY_HASH = 0x338ee25354eba1e0ea3d435dce293825bc9f8143a25d97c1ecfeb5eb29ad3f2e;
    uint256 private constant BUDGET_UNITS = 1_000_000;
    uint64 private constant NOW_TS = 1_999_960_000;
    uint64 private constant FUNDING_DEADLINE = NOW_TS + 15 minutes;
    uint64 private constant ACTIVATION_DEADLINE = NOW_TS + 10 minutes;
    uint256 private constant BUYER_KEY = 0xB001;
    uint256 private constant FUNDING_SIGNER_KEY = 0xF001;
    uint256 private constant INTENT_SIGNER_KEY = 0x1A01;
    uint256 private constant SECOND_INTENT_SIGNER_KEY = 0x1A02;
    address private constant RELAYER = address(0xA11CE);
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    struct FactoryDeployment {
        ResearchEscrow implementation;
        DataSourceRegistry registry;
        ResearchEscrowFactory factory;
        MockUSDC usdc;
    }

    function testBuyerEoaActivationCanBeSubmittedByRelayerAndFreezesIntentSigner() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer, RESEARCH_KEY, 1);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 11, ACTIVATION_DEADLINE);
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        VM.prank(RELAYER);
        IResearchEscrowActivation(escrow).activate(authorization, signature);

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
        assert(IResearchEscrowActivation(escrow).activeIntentSigner() == voucher.intentSigner);
        assert(IResearchEscrowActivation(escrow).activationNonceUsed(authorization.activationNonce));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
    }

    function testBuyerErc1271ActivationCanBeSubmittedByRelayer() public {
        MockErc1271Buyer buyer = new MockErc1271Buyer();
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(address(buyer), ERC1271_RESEARCH_KEY, 2);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 12, ACTIVATION_DEADLINE);
        bytes memory signature = abi.encodePacked("erc1271-activation-ok");
        buyer.setValidSignature(
            ResearchEscrowEip712.activationAuthorizationDigest(block.chainid, escrow, authorization), signature
        );

        VM.prank(RELAYER);
        IResearchEscrowActivation(escrow).activate(authorization, signature);

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
        assert(IResearchEscrowActivation(escrow).activeIntentSigner() == voucher.intentSigner);
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
    }

    function testRejectsActivationReplayWithSameNonce() public {
        address buyer = VM.addr(BUYER_KEY);
        (, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _fundedEscrow(buyer, RESEARCH_KEY, 3);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 13, ACTIVATION_DEADLINE);
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        VM.prank(RELAYER);
        IResearchEscrowActivation(escrow).activate(authorization, signature);

        _expectActivationRevert(escrow, authorization, signature);
        assert(IResearchEscrowActivation(escrow).activationNonceUsed(authorization.activationNonce));
    }

    function testRejectsAuthorizationDeadlineAfterActivationCutoff() public {
        address buyer = VM.addr(BUYER_KEY);
        (, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _fundedEscrow(buyer, RESEARCH_KEY, 4);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 14, uint64(voucher.fundingDeadline + 1));
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        _expectActivationRevert(escrow, authorization, signature);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
    }

    function testRejectsActivationAfterCutoffEvenWithBuyerSignature() public {
        address buyer = VM.addr(BUYER_KEY);
        (, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _fundedEscrow(buyer, RESEARCH_KEY, 5);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 15, voucher.fundingDeadline);
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        VM.warp(uint256(voucher.fundingDeadline) + 1);

        _expectActivationRevert(escrow, authorization, signature);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
    }

    function testIntentSignerRemainsFrozenAfterFactoryAllowlistRotates() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer, RESEARCH_KEY, 6);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 16, ACTIVATION_DEADLINE);
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        VM.prank(RELAYER);
        IResearchEscrowActivation(escrow).activate(authorization, signature);

        bytes32 intentSignerRole = deployment.factory.INTENT_SIGNER_ROLE();
        VM.prank(FACTORY_ADMIN);
        deployment.factory.grantRole(intentSignerRole, VM.addr(SECOND_INTENT_SIGNER_KEY));
        VM.prank(FACTORY_ADMIN);
        deployment.factory.revokeRole(intentSignerRole, voucher.intentSigner);

        assert(IResearchEscrowActivation(escrow).activeIntentSigner() == voucher.intentSigner);
    }

    function testRejectsActivationForIntentSignerDifferentFromFundingVoucher() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer, RESEARCH_KEY, 17);
        bytes32 intentSignerRole = deployment.factory.INTENT_SIGNER_ROLE();
        address secondIntentSigner = VM.addr(SECOND_INTENT_SIGNER_KEY);

        VM.prank(FACTORY_ADMIN);
        deployment.factory.grantRole(intentSignerRole, secondIntentSigner);

        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 18, ACTIVATION_DEADLINE);
        authorization.intentSigner = secondIntentSigner;
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        _expectActivationRevert(escrow, authorization, signature);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
    }

    function testBuyerCanCancelUnactivatedAndReceiveFullRefund() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment,, address escrow) = _fundedEscrow(buyer, RESEARCH_KEY, 19);
        assert(deployment.usdc.balanceOf(buyer) == 0);

        VM.prank(buyer);
        IResearchEscrowActivation(escrow).cancelUnactivated();

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS);
    }

    function testActivationAfterCancelIsRejected() public {
        address buyer = VM.addr(BUYER_KEY);
        (, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _fundedEscrow(buyer, RESEARCH_KEY, 20);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 22, ACTIVATION_DEADLINE);
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        VM.prank(buyer);
        IResearchEscrowActivation(escrow).cancelUnactivated();

        _expectActivationRevert(escrow, authorization, signature);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
    }

    function testCancelAfterActivationIsRejected() public {
        address buyer = VM.addr(BUYER_KEY);
        (, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) = _fundedEscrow(buyer, RESEARCH_KEY, 23);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 24, ACTIVATION_DEADLINE);
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        VM.prank(RELAYER);
        IResearchEscrowActivation(escrow).activate(authorization, signature);

        VM.prank(buyer);
        (bool success,) = escrow.call(abi.encodeCall(IResearchEscrowActivation.cancelUnactivated, ()));

        assert(!success);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
    }

    function testCreationPauseDoesNotBlockFundedCancel() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment,, address escrow) = _fundedEscrow(buyer, RESEARCH_KEY, 25);

        VM.prank(FACTORY_ADMIN);
        deployment.factory.pauseCreation();

        VM.prank(buyer);
        IResearchEscrowActivation(escrow).cancelUnactivated();

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
        assert(deployment.usdc.balanceOf(escrow) == 0);
        assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS);
    }

    function testCreationPauseBlocksActivationWithoutConsumingNonce() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer, RESEARCH_KEY, 26);
        ResearchEscrowEip712.ActivationAuthorization memory authorization =
            _validActivation(escrow, voucher, 27, ACTIVATION_DEADLINE);
        bytes memory signature = _signActivation(escrow, authorization, BUYER_KEY);

        VM.prank(FACTORY_ADMIN);
        deployment.factory.pauseCreation();

        VM.prank(RELAYER);
        (bool pausedSuccess,) =
            escrow.call(abi.encodeCall(IResearchEscrowActivation.activate, (authorization, signature)));

        assert(!pausedSuccess);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
        assert(!IResearchEscrowActivation(escrow).activationNonceUsed(authorization.activationNonce));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);

        VM.prank(FACTORY_ADMIN);
        deployment.factory.unpauseCreation();

        VM.prank(RELAYER);
        IResearchEscrowActivation(escrow).activate(authorization, signature);

        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Active);
        assert(IResearchEscrowActivation(escrow).activationNonceUsed(authorization.activationNonce));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
    }

    function testFundedEscrowStartsWithCleanActivationAccounting() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment,, address escrow) = _fundedEscrow(buyer, RESEARCH_KEY, 7);

        assert(IResearchEscrowFundedGuards(escrow).spent() == 0);
        assert(IResearchEscrowFundedGuards(escrow).accountedBalance() == BUDGET_UNITS);
        assert(!IResearchEscrowFundedGuards(escrow).processedRequestKey(REQUEST_KEY));
        assert(!IResearchEscrowFundedGuards(escrow).processedSettlementKey(SETTLEMENT_KEY));
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
    }

    function testFundedEscrowRejectsSettlementFromMaliciousSettler() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer, RESEARCH_KEY, 8);
        _grantSettlerRole(deployment.factory);

        CanonicalResearch.SettlementItem[] memory items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY,
            sourceId: SOURCE_ID,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: 1000,
            amount: 100
        });
        ResearchEscrowEip712.SettlementAuthorization memory authorization =
            _validSettlementAuthorization(escrow, voucher, 21);
        bytes memory signature = _signSettlementAuthorization(escrow, authorization);

        VM.prank(SETTLER);
        (bool success,) = escrow.call(
            abi.encodeCall(IResearchEscrowFundedGuards.settleBatch, (SETTLEMENT_KEY, items, authorization, signature))
        );

        assert(!success);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
    }

    function testFundedEscrowRejectsSignedActiveCloseFromMaliciousSettler() public {
        address buyer = VM.addr(BUYER_KEY);
        (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
            _fundedEscrow(buyer, RESEARCH_KEY, 9);
        _grantSettlerRole(deployment.factory);

        ResearchEscrowEip712.CloseAuthorization memory authorization = ResearchEscrowEip712.CloseAuthorization({
            escrow: escrow,
            researchKey: voucher.researchKey,
            closeReason: 1,
            finalLiabilityHash: FINAL_LIABILITY_HASH,
            spent: 100,
            nonce: 31,
            issuedAt: NOW_TS,
            deadline: uint64(NOW_TS + 5 minutes)
        });
        bytes memory signature = _signCloseAuthorization(escrow, authorization);

        VM.prank(SETTLER);
        (bool success,) = escrow.call(abi.encodeCall(IResearchEscrowFundedGuards.close, (authorization, signature)));

        assert(!success);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
        assert(deployment.usdc.balanceOf(escrow) == BUDGET_UNITS);
    }

    function _fundedEscrow(address buyer, bytes32 researchKey, uint256 voucherNonce)
        private
        returns (
            FactoryDeployment memory deployment,
            ResearchEscrowEip712.FundingVoucher memory voucher,
            address escrow
        )
    {
        deployment = _publishedFactoryWithMockUsdc();
        voucher = _validFundingVoucher(deployment.factory, buyer, researchKey, voucherNonce);
        bytes memory signature = _signFundingVoucher(deployment.factory, voucher);
        deployment.usdc.mint(buyer, BUDGET_UNITS);

        VM.prank(buyer);
        assert(deployment.usdc.approve(address(deployment.factory), BUDGET_UNITS));

        VM.prank(buyer);
        escrow = deployment.factory.createAndFund(voucher, signature);
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

        VM.prank(FACTORY_ADMIN);
        deployment.factory.revokeRole(factoryAdminRole, DEPLOYMENT_KEY);
        VM.prank(REGISTRY_ADMIN);
        deployment.registry.revokeRole(registryAdminRole, DEPLOYMENT_KEY);
        VM.warp(NOW_TS);
    }

    function _validFundingVoucher(ResearchEscrowFactory factory, address buyer, bytes32 researchKey, uint256 nonce)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory)
    {
        return ResearchEscrowEip712.FundingVoucher({
            buyer: buyer,
            researchKey: researchKey,
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

    function _grantSettlerRole(ResearchEscrowFactory factory) private {
        bytes32 settlerRole = factory.SETTLER_ROLE();

        VM.prank(FACTORY_ADMIN);
        factory.grantRole(settlerRole, SETTLER);
    }

    function _validSettlementAuthorization(
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        uint256 nonce
    ) private pure returns (ResearchEscrowEip712.SettlementAuthorization memory) {
        return ResearchEscrowEip712.SettlementAuthorization({
            escrow: escrow,
            researchKey: voucher.researchKey,
            settlementKey: SETTLEMENT_KEY,
            itemsHash: ITEMS_HASH,
            total: 100,
            itemCount: 1,
            nonce: nonce,
            issuedAt: NOW_TS,
            deadline: uint64(NOW_TS + 5 minutes)
        });
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
        bytes32 digest = ResearchEscrowEip712.closeAuthorizationDigest(block.chainid, escrow, authorization);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(INTENT_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _expectActivationRevert(
        address escrow,
        ResearchEscrowEip712.ActivationAuthorization memory authorization,
        bytes memory signature
    ) private {
        VM.prank(RELAYER);
        (bool success,) = escrow.call(abi.encodeCall(IResearchEscrowActivation.activate, (authorization, signature)));
        assert(!success);
    }
}

contract MockErc1271Buyer {
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;
    bytes32 private _validDigest;
    bytes32 private _validSignatureHash;

    function setValidSignature(bytes32 digest, bytes memory signature) external {
        _validDigest = digest;
        _validSignatureHash = keccak256(signature);
    }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        if (digest == _validDigest && keccak256(signature) == _validSignatureHash) {
            return MAGIC_VALUE;
        }

        return 0xffffffff;
    }
}
