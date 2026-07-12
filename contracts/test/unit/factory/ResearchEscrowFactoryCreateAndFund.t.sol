// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";
import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {FalseReturnToken} from "../../fixtures/tokens/FalseReturnToken.sol";
import {MockUSDC} from "../../fixtures/tokens/MockUSDC.sol";
import {RevertingToken} from "../../fixtures/tokens/RevertingToken.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface CreateAndFundVm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract ResearchEscrowFactoryCreateAndFundTest is RoleIsolationFixture {
    CreateAndFundVm private constant VM = CreateAndFundVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant SECOND_RESEARCH_KEY = 0x6e5b469ca5872e4c14a6a32e7f16ed8e1ce63e34d43d785174046b2434e7a8d2;
    uint256 private constant BUDGET_UNITS = 1_000_000;
    uint64 private constant NOW_TS = 1_999_960_000;
    uint64 private constant FUNDING_DEADLINE = NOW_TS + 15 minutes;
    uint256 private constant FUNDING_SIGNER_KEY = 0xF001;
    uint256 private constant INTENT_SIGNER_KEY = 0x1A01;
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

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

    struct FactoryDeployment {
        ResearchEscrow implementation;
        DataSourceRegistry registry;
        ResearchEscrowFactory factory;
        MockUSDC usdc;
    }

    function testCreateAndFundCreatesInitializesRegistersFundsAndEmitsLineage() public {
        FactoryDeployment memory deployment = _publishedFactoryWithMockUsdc();
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, RESEARCH_KEY, 1);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        address predicted = deployment.factory.predictEscrow(BUYER, RESEARCH_KEY);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        uint256 buyerBefore = deployment.usdc.balanceOf(BUYER);
        uint256 escrowBefore = deployment.usdc.balanceOf(predicted);
        assert(predicted.code.length == 0);

        VM.expectEmit(true, true, true, true, address(deployment.factory));
        emit ResearchEscrowCreated(BUYER, RESEARCH_KEY, predicted, address(deployment.implementation));
        VM.expectEmit(true, true, true, true, address(deployment.factory));
        emit ResearchEscrowFunded(
            BUYER, RESEARCH_KEY, predicted, BUDGET_UNITS, voucher.expectedExpiresAt, voucher.fundingDeadline
        );

        VM.prank(BUYER);
        address escrow = deployment.factory.createAndFund(voucher, signature);

        assert(escrow == predicted);
        assert(deployment.factory.escrowOf(BUYER, RESEARCH_KEY) == escrow);
        assert(escrow.code.length != 0);
        assert(buyerBefore - deployment.usdc.balanceOf(BUYER) == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(escrow) - escrowBefore == BUDGET_UNITS);
        _assertFundedClone(deployment, escrow, voucher);
    }

    function testAllowanceFailureRollsBackCloneMappingNonceAndBalances() public {
        FactoryDeployment memory deployment = _publishedFactoryWithMockUsdc();
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, RESEARCH_KEY, 2);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS - 1);

        _expectCreateAndFundRevertWithoutState(deployment, voucher, signature);

        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);
        _createAndFundWithoutEventChecks(deployment, voucher, signature);
    }

    function testBalanceFailureRollsBackCloneMappingNonceAndBalances() public {
        FactoryDeployment memory deployment = _publishedFactoryWithMockUsdc();
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, RESEARCH_KEY, 3);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS - 1);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        _expectCreateAndFundRevertWithoutState(deployment, voucher, signature);

        deployment.usdc.mint(BUYER, 1);
        _createAndFundWithoutEventChecks(deployment, voucher, signature);
    }

    function testBudgetTamperingRollsBackWithoutState() public {
        FactoryDeployment memory partialDeployment = _publishedFactoryWithMockUsdc();
        ResearchEscrowEip712.FundingVoucher memory partialVoucher =
            _validVoucher(partialDeployment.factory, RESEARCH_KEY, 4);
        bytes memory partialSignature = _signVoucher(partialDeployment.factory, partialVoucher);
        partialVoucher.budgetUnits = BUDGET_UNITS - 1;
        partialDeployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(partialDeployment.usdc, address(partialDeployment.factory), BUDGET_UNITS);

        _expectCreateAndFundRevertWithoutState(partialDeployment, partialVoucher, partialSignature);

        FactoryDeployment memory overDeployment = _publishedFactoryWithMockUsdc();
        ResearchEscrowEip712.FundingVoucher memory overVoucher = _validVoucher(overDeployment.factory, RESEARCH_KEY, 5);
        bytes memory overSignature = _signVoucher(overDeployment.factory, overVoucher);
        overVoucher.budgetUnits = BUDGET_UNITS + 1;
        overDeployment.usdc.mint(BUYER, BUDGET_UNITS + 1);
        _approveBudget(overDeployment.usdc, address(overDeployment.factory), BUDGET_UNITS + 1);

        _expectCreateAndFundRevertWithoutState(overDeployment, overVoucher, overSignature);
    }

    function testReplayAndTopUpAreRejectedWithoutMovingMoreFunds() public {
        FactoryDeployment memory deployment = _publishedFactoryWithMockUsdc();
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, RESEARCH_KEY, 6);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS * 3);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS * 3);

        address escrow = _createAndFundWithoutEventChecks(deployment, voucher, signature);
        _expectCreateAndFundRevertWithoutChangingFundedEscrow(deployment, voucher, signature, escrow);

        ResearchEscrowEip712.FundingVoucher memory topUpVoucher = _validVoucher(deployment.factory, RESEARCH_KEY, 7);
        topUpVoucher.budgetUnits = BUDGET_UNITS * 2;
        bytes memory topUpSignature = _signVoucher(deployment.factory, topUpVoucher);

        _expectCreateAndFundRevertWithoutChangingFundedEscrow(deployment, topUpVoucher, topUpSignature, escrow);
    }

    function testFalseReturnTransferFromRollsBackCloneMappingNonceAndBalances() public {
        FactoryDeployment memory deployment = _publishedFactoryWithTokenRuntime(address(new FalseReturnToken()).code);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, SECOND_RESEARCH_KEY, 8);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        _expectCreateAndFundRevertWithoutState(deployment, voucher, signature);

        _installOfficialUsdcRuntime(address(new MockUSDC()).code);
        _createAndFundWithoutEventChecks(deployment, voucher, signature);
    }

    function testRevertingTransferFromRollsBackCloneMappingNonceAndBalances() public {
        FactoryDeployment memory deployment = _publishedFactoryWithTokenRuntime(address(new RevertingToken()).code);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, SECOND_RESEARCH_KEY, 9);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        _expectCreateAndFundRevertWithoutState(deployment, voucher, signature);

        _installOfficialUsdcRuntime(address(new MockUSDC()).code);
        _createAndFundWithoutEventChecks(deployment, voucher, signature);
    }

    function _publishedFactoryWithMockUsdc() private returns (FactoryDeployment memory deployment) {
        return _publishedFactoryWithTokenRuntime(address(new MockUSDC()).code);
    }

    function _publishedFactoryWithTokenRuntime(bytes memory tokenRuntime)
        private
        returns (FactoryDeployment memory deployment)
    {
        _installOfficialUsdcRuntime(tokenRuntime);
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

    function _installOfficialUsdcRuntime(bytes memory tokenRuntime) private {
        VM.etch(ARC_TESTNET_USDC, tokenRuntime);
    }

    function _validVoucher(ResearchEscrowFactory factory, bytes32 researchKey, uint256 nonce)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory)
    {
        return ResearchEscrowEip712.FundingVoucher({
            buyer: BUYER,
            researchKey: researchKey,
            budgetUnits: BUDGET_UNITS,
            expectedExpiresAt: uint64(NOW_TS + factory.MIN_ESCROW_TTL()),
            fundingDeadline: FUNDING_DEADLINE,
            intentSigner: VM.addr(INTENT_SIGNER_KEY),
            voucherNonce: nonce
        });
    }

    function _signVoucher(ResearchEscrowFactory factory, ResearchEscrowEip712.FundingVoucher memory voucher)
        private
        returns (bytes memory)
    {
        bytes32 digest = ResearchEscrowEip712.fundingVoucherDigest(block.chainid, address(factory), voucher);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(FUNDING_SIGNER_KEY, digest);

        return abi.encodePacked(r, s, v);
    }

    function _approveBudget(MockUSDC usdc, address spender, uint256 amount) private {
        VM.prank(BUYER);
        assert(usdc.approve(spender, amount));
    }

    function _createAndFundWithoutEventChecks(
        FactoryDeployment memory deployment,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes memory signature
    ) private returns (address escrow) {
        address predicted = deployment.factory.predictEscrow(voucher.buyer, voucher.researchKey);

        VM.prank(BUYER);
        escrow = deployment.factory.createAndFund(voucher, signature);

        assert(escrow == predicted);
        assert(deployment.factory.escrowOf(voucher.buyer, voucher.researchKey) == escrow);
        assert(escrow.code.length != 0);
        _assertFundedClone(deployment, escrow, voucher);
    }

    function _expectCreateAndFundRevertWithoutState(
        FactoryDeployment memory deployment,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes memory signature
    ) private {
        address predicted = deployment.factory.predictEscrow(voucher.buyer, voucher.researchKey);
        uint256 buyerBefore = deployment.usdc.balanceOf(voucher.buyer);
        uint256 escrowBefore = deployment.usdc.balanceOf(predicted);
        uint256 allowanceBefore = deployment.usdc.allowance(voucher.buyer, address(deployment.factory));

        VM.prank(BUYER);
        (bool success,) =
            address(deployment.factory).call(abi.encodeCall(deployment.factory.createAndFund, (voucher, signature)));

        assert(!success);
        assert(predicted.code.length == 0);
        assert(deployment.factory.escrowOf(voucher.buyer, voucher.researchKey) == address(0));
        assert(deployment.usdc.balanceOf(voucher.buyer) == buyerBefore);
        assert(deployment.usdc.balanceOf(predicted) == escrowBefore);
        assert(deployment.usdc.allowance(voucher.buyer, address(deployment.factory)) == allowanceBefore);
    }

    function _expectCreateAndFundRevertWithoutChangingFundedEscrow(
        FactoryDeployment memory deployment,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes memory signature,
        address escrow
    ) private {
        uint256 buyerBefore = deployment.usdc.balanceOf(voucher.buyer);
        uint256 escrowBefore = deployment.usdc.balanceOf(escrow);

        VM.prank(BUYER);
        (bool success,) =
            address(deployment.factory).call(abi.encodeCall(deployment.factory.createAndFund, (voucher, signature)));

        assert(!success);
        assert(deployment.factory.escrowOf(voucher.buyer, voucher.researchKey) == escrow);
        assert(escrow.code.length != 0);
        assert(deployment.usdc.balanceOf(voucher.buyer) == buyerBefore);
        assert(deployment.usdc.balanceOf(escrow) == escrowBefore);
    }

    function _assertFundedClone(
        FactoryDeployment memory deployment,
        address escrow,
        ResearchEscrowEip712.FundingVoucher memory voucher
    ) private view {
        assert(ResearchEscrow(escrow).factory() == address(deployment.factory));
        assert(ResearchEscrow(escrow).registry() == address(deployment.registry));
        assert(ResearchEscrow(escrow).usdc() == ARC_TESTNET_USDC);
        assert(ResearchEscrow(escrow).buyer() == voucher.buyer);
        assert(ResearchEscrow(escrow).researchKey() == voucher.researchKey);
        assert(ResearchEscrow(escrow).initialBudget() == voucher.budgetUnits);
        assert(ResearchEscrow(escrow).expectedExpiresAt() == voucher.expectedExpiresAt);
        assert(ResearchEscrow(escrow).activationCutoff() == voucher.fundingDeadline);
        assert(ResearchEscrow(escrow).plannedIntentSigner() == voucher.intentSigner);
        assert(ResearchEscrow(escrow).activeIntentSigner() == address(0));
        assert(ResearchEscrow(escrow).spent() == 0);
        assert(ResearchEscrow(escrow).accountedBalance() == voucher.budgetUnits);
        assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Funded);
    }
}
