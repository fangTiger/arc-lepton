// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";
import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {FalseReturnToken} from "../../fixtures/tokens/FalseReturnToken.sol";
import {FeeOnTransferToken} from "../../fixtures/tokens/FeeOnTransferToken.sol";
import {MockUSDC} from "../../fixtures/tokens/MockUSDC.sol";
import {RevertingToken} from "../../fixtures/tokens/RevertingToken.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface BalanceDeltaVm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract ResearchEscrowFactoryBalanceDeltaTest is RoleIsolationFixture {
    BalanceDeltaVm private constant VM = BalanceDeltaVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant LOW_BUDGET_RESEARCH_KEY =
        0x4f2f247ce9c24bbd6b7e4db84cdd4061f00f2f4f7a067c7ec64c07dfd2fdf901;
    bytes32 private constant HIGH_BUDGET_RESEARCH_KEY =
        0xa2ee7f80ea5e764d3d7ab27f5710b31d9ce86c7cf6bb1e407759d982df41ea11;
    uint256 private constant BUDGET_UNITS = 1_000_000;
    uint64 private constant NOW_TS = 1_999_960_000;
    uint64 private constant FUNDING_DEADLINE = NOW_TS + 15 minutes;
    uint256 private constant FUNDING_SIGNER_KEY = 0xF001;
    uint256 private constant INTENT_SIGNER_KEY = 0x1A01;
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    struct FactoryDeployment {
        ResearchEscrow implementation;
        DataSourceRegistry registry;
        ResearchEscrowFactory factory;
        MockUSDC usdc;
    }

    function testCreateAndFundRequiresExactBuyerAndCloneBalanceDeltas() public {
        FactoryDeployment memory deployment = _publishedFactoryWithTokenRuntime(address(new MockUSDC()).code);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, 1);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        address predicted = deployment.factory.predictEscrow(BUYER, RESEARCH_KEY);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        uint256 buyerBefore = deployment.usdc.balanceOf(BUYER);
        uint256 cloneBefore = deployment.usdc.balanceOf(predicted);

        VM.prank(BUYER);
        address escrow = deployment.factory.createAndFund(voucher, signature);

        assert(escrow == predicted);
        assert(escrow != BUYER);
        assert(buyerBefore - deployment.usdc.balanceOf(BUYER) == BUDGET_UNITS);
        assert(deployment.usdc.balanceOf(escrow) - cloneBefore == BUDGET_UNITS);
    }

    function testDifferentValidVoucherBudgetsUseExactDeltas() public {
        FactoryDeployment memory deployment = _publishedFactoryWithTokenRuntime(address(new MockUSDC()).code);

        ResearchEscrowEip712.FundingVoucher memory lowBudgetVoucher =
            _validVoucherWithBudget(deployment.factory, LOW_BUDGET_RESEARCH_KEY, 2, 1);
        bytes memory lowBudgetSignature = _signVoucher(deployment.factory, lowBudgetVoucher);
        deployment.usdc.mint(BUYER, 1);
        _approveBudget(deployment.usdc, address(deployment.factory), 1);
        _createAndFundAndAssertExactDeltas(deployment, lowBudgetVoucher, lowBudgetSignature);

        ResearchEscrowEip712.FundingVoucher memory highBudgetVoucher =
            _validVoucherWithBudget(deployment.factory, HIGH_BUDGET_RESEARCH_KEY, 3, BUDGET_UNITS * 2);
        bytes memory highBudgetSignature = _signVoucher(deployment.factory, highBudgetVoucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS * 2);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS * 2);
        _createAndFundAndAssertExactDeltas(deployment, highBudgetVoucher, highBudgetSignature);
    }

    function testFeeOnTransferTokenRollsBackAndNonceCanRetry() public {
        FactoryDeployment memory deployment = _publishedFactoryWithTokenRuntime(address(new FeeOnTransferToken()).code);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, 4);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        _expectCreateAndFundRevertWithoutState(deployment, voucher, signature);

        _installOfficialUsdcRuntime(address(new MockUSDC()).code);
        _createAndFundAndAssertExactDeltas(deployment, voucher, signature);
    }

    function testFalseReturnTokenRollsBackAndNonceCanRetry() public {
        FactoryDeployment memory deployment = _publishedFactoryWithTokenRuntime(address(new FalseReturnToken()).code);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, 5);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        _expectCreateAndFundRevertWithoutState(deployment, voucher, signature);

        _installOfficialUsdcRuntime(address(new MockUSDC()).code);
        _createAndFundAndAssertExactDeltas(deployment, voucher, signature);
    }

    function testRevertingTokenRollsBackAndNonceCanRetry() public {
        FactoryDeployment memory deployment = _publishedFactoryWithTokenRuntime(address(new RevertingToken()).code);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, 6);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        _expectCreateAndFundRevertWithoutState(deployment, voucher, signature);

        _installOfficialUsdcRuntime(address(new MockUSDC()).code);
        _createAndFundAndAssertExactDeltas(deployment, voucher, signature);
    }

    function testSelfTransferLikeTokenRollsBackAndNonceCanRetry() public {
        FactoryDeployment memory deployment = _publishedFactoryWithTokenRuntime(address(new SelfTransferToken()).code);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(deployment.factory, 7);
        bytes memory signature = _signVoucher(deployment.factory, voucher);
        deployment.usdc.mint(BUYER, BUDGET_UNITS);
        _approveBudget(deployment.usdc, address(deployment.factory), BUDGET_UNITS);

        _expectCreateAndFundRevertWithoutState(deployment, voucher, signature);

        _installOfficialUsdcRuntime(address(new MockUSDC()).code);
        _createAndFundAndAssertExactDeltas(deployment, voucher, signature);
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

    function _validVoucher(ResearchEscrowFactory factory, uint256 nonce)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory)
    {
        return _validVoucherWithBudget(factory, RESEARCH_KEY, nonce, BUDGET_UNITS);
    }

    function _validVoucherWithBudget(ResearchEscrowFactory factory, bytes32 researchKey, uint256 nonce, uint256 budget)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory)
    {
        return ResearchEscrowEip712.FundingVoucher({
            buyer: BUYER,
            researchKey: researchKey,
            budgetUnits: budget,
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

    function _createAndFundAndAssertExactDeltas(
        FactoryDeployment memory deployment,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes memory signature
    ) private returns (address escrow) {
        address predicted = deployment.factory.predictEscrow(voucher.buyer, voucher.researchKey);
        uint256 buyerBefore = deployment.usdc.balanceOf(voucher.buyer);
        uint256 cloneBefore = deployment.usdc.balanceOf(predicted);

        VM.prank(BUYER);
        escrow = deployment.factory.createAndFund(voucher, signature);

        assert(escrow == predicted);
        assert(escrow != voucher.buyer);
        assert(buyerBefore - deployment.usdc.balanceOf(voucher.buyer) == voucher.budgetUnits);
        assert(deployment.usdc.balanceOf(escrow) - cloneBefore == voucher.budgetUnits);
    }

    function _expectCreateAndFundRevertWithoutState(
        FactoryDeployment memory deployment,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes memory signature
    ) private {
        address predicted = deployment.factory.predictEscrow(voucher.buyer, voucher.researchKey);
        uint256 buyerBefore = deployment.usdc.balanceOf(voucher.buyer);
        uint256 cloneBefore = deployment.usdc.balanceOf(predicted);
        uint256 allowanceBefore = deployment.usdc.allowance(voucher.buyer, address(deployment.factory));

        VM.prank(BUYER);
        (bool success,) =
            address(deployment.factory).call(abi.encodeCall(deployment.factory.createAndFund, (voucher, signature)));

        assert(!success);
        assert(predicted.code.length == 0);
        assert(deployment.factory.escrowOf(voucher.buyer, voucher.researchKey) == address(0));
        assert(deployment.usdc.balanceOf(voucher.buyer) == buyerBefore);
        assert(deployment.usdc.balanceOf(predicted) == cloneBefore);
        assert(deployment.usdc.allowance(voucher.buyer, address(deployment.factory)) == allowanceBefore);
    }
}

/// @notice 模拟 token 返回成功但把 transferFrom 变成 from->from 自转，测试 Factory 是否校验真实差额。
contract SelfTransferToken is MockUSDC {
    function transferFrom(address from, address, uint256 value) public override returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _update(from, from, value);
        return true;
    }
}
