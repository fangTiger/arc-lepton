// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";
import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface FundingVoucherVm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract ResearchEscrowFactoryFundingVoucherTest is RoleIsolationFixture {
    FundingVoucherVm private constant VM = FundingVoucherVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    uint256 private constant BUDGET_UNITS = 1_000_000;
    uint64 private constant NOW_TS = 1_999_960_000;
    uint64 private constant FUNDING_DEADLINE = NOW_TS + 15 minutes;
    uint256 private constant FUNDING_SIGNER_KEY = 0xF001;
    uint256 private constant INTENT_SIGNER_KEY = 0x1A01;
    uint256 private constant SECOND_INTENT_SIGNER_KEY = 0x1A02;
    uint256 private constant UNAUTHORIZED_SIGNER_KEY = 0xBADF00D;

    function testRejectsVoucherWhenRegistryHasNotReverseBoundFactory() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _deployFactoryWithUnboundRegistry();
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 1);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function testRejectsVoucherWhileDeploymentKeyStillFactoryAdmin() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(false, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 2);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function testRejectsVoucherWhileDeploymentKeyStillRegistryAdmin() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, false);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 3);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function testConsumesValidVoucherAfterDeploymentKeyIsRevokedEverywhere() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 4);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        VM.prank(BUYER);
        assert(factory.consumeFundingVoucherFromSenderForTest(voucher, signature) == BUDGET_UNITS);
    }

    function testRejectsSenderDifferentFromVoucherBuyer() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 5);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        _expectVoucherRevertFromSender(factory, address(0xB0B0), voucher, signature);
    }

    function testRejectsFundingSignatureFromAccountWithoutFundingRole() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 6);
        bytes memory signature = _signVoucher(factory, voucher, UNAUTHORIZED_SIGNER_KEY);

        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function testRejectsFundingSignerReusedAsIntentSigner() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 7);
        voucher.intentSigner = VM.addr(FUNDING_SIGNER_KEY);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function testRejectsFundingAndIntentSignerRoleGrantsToSameAccount() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);

        _expectRoleGrantRevert(factory, factory.INTENT_SIGNER_ROLE(), VM.addr(FUNDING_SIGNER_KEY));
        _expectRoleGrantRevert(factory, factory.FUNDING_SIGNER_ROLE(), VM.addr(INTENT_SIGNER_KEY));
    }

    function testRejectsIntentSignerWithoutExclusiveIntentRole() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 8);
        voucher.intentSigner = VM.addr(SECOND_INTENT_SIGNER_KEY);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function testRejectsExpiredFundingDeadline() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 9);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        VM.warp(uint256(FUNDING_DEADLINE) + 1);

        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function testRejectsExpectedExpiryShorterThanMinEscrowTtl() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 10);
        voucher.expectedExpiresAt = uint64(NOW_TS + factory.MIN_ESCROW_TTL() - 1);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function testConsumesVoucherNonceOnlyOnce() public {
        (,, ResearchEscrowFactoryFundingHarness factory) = _bootstrapFactory(true, true);
        ResearchEscrowEip712.FundingVoucher memory voucher = _validVoucher(factory, 11);
        bytes memory signature = _signVoucher(factory, voucher, FUNDING_SIGNER_KEY);

        VM.prank(BUYER);
        assert(factory.consumeFundingVoucherFromSenderForTest(voucher, signature) == BUDGET_UNITS);
        _expectVoucherRevertFromSender(factory, BUYER, voucher, signature);
    }

    function _bootstrapFactory(bool revokeFactoryDeployer, bool revokeRegistryDeployer)
        private
        returns (
            ResearchEscrow implementation,
            DataSourceRegistry registry,
            ResearchEscrowFactoryFundingHarness factory
        )
    {
        implementation = new ResearchEscrow();
        registry = new DataSourceRegistry(DEPLOYMENT_KEY);
        factory = new ResearchEscrowFactoryFundingHarness(address(implementation), address(registry), DEPLOYMENT_KEY);
        bytes32 factoryAdminRole = factory.DEFAULT_ADMIN_ROLE();
        bytes32 registryAdminRole = registry.DEFAULT_ADMIN_ROLE();
        bytes32 fundingSignerRole = factory.FUNDING_SIGNER_ROLE();
        bytes32 intentSignerRole = factory.INTENT_SIGNER_ROLE();

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

        if (revokeFactoryDeployer) {
            VM.prank(FACTORY_ADMIN);
            factory.revokeRole(factoryAdminRole, DEPLOYMENT_KEY);
        }
        if (revokeRegistryDeployer) {
            VM.prank(REGISTRY_ADMIN);
            registry.revokeRole(registryAdminRole, DEPLOYMENT_KEY);
        }

        VM.warp(NOW_TS);
    }

    function _deployFactoryWithUnboundRegistry()
        private
        returns (
            ResearchEscrow implementation,
            DataSourceRegistry registry,
            ResearchEscrowFactoryFundingHarness factory
        )
    {
        implementation = new ResearchEscrow();
        registry = new DataSourceRegistry(DEPLOYMENT_KEY);
        factory = new ResearchEscrowFactoryFundingHarness(address(implementation), address(registry), DEPLOYMENT_KEY);
        bytes32 fundingSignerRole = factory.FUNDING_SIGNER_ROLE();
        bytes32 intentSignerRole = factory.INTENT_SIGNER_ROLE();

        VM.prank(DEPLOYMENT_KEY);
        factory.grantRole(fundingSignerRole, VM.addr(FUNDING_SIGNER_KEY));
        VM.prank(DEPLOYMENT_KEY);
        factory.grantRole(intentSignerRole, VM.addr(INTENT_SIGNER_KEY));
        VM.warp(NOW_TS);
    }

    function _validVoucher(ResearchEscrowFactoryFundingHarness factory, uint256 nonce)
        private
        returns (ResearchEscrowEip712.FundingVoucher memory)
    {
        return ResearchEscrowEip712.FundingVoucher({
            buyer: BUYER,
            researchKey: RESEARCH_KEY,
            budgetUnits: BUDGET_UNITS,
            expectedExpiresAt: uint64(NOW_TS + factory.MIN_ESCROW_TTL()),
            fundingDeadline: FUNDING_DEADLINE,
            intentSigner: VM.addr(INTENT_SIGNER_KEY),
            voucherNonce: nonce
        });
    }

    function _signVoucher(
        ResearchEscrowFactoryFundingHarness factory,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        uint256 privateKey
    ) private returns (bytes memory) {
        bytes32 digest = ResearchEscrowEip712.fundingVoucherDigest(block.chainid, address(factory), voucher);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);

        return abi.encodePacked(r, s, v);
    }

    function _expectVoucherRevertFromSender(
        ResearchEscrowFactoryFundingHarness factory,
        address caller,
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes memory signature
    ) private {
        VM.prank(caller);
        (bool success,) =
            address(factory).call(abi.encodeCall(factory.consumeFundingVoucherFromSenderForTest, (voucher, signature)));
        assert(!success);
    }

    function _expectRoleGrantRevert(ResearchEscrowFactoryFundingHarness factory, bytes32 role, address account)
        private
    {
        VM.prank(FACTORY_ADMIN);
        (bool success,) = address(factory).call(abi.encodeCall(factory.grantRole, (role, account)));
        assert(!success);
    }
}

contract ResearchEscrowFactoryFundingHarness is ResearchEscrowFactory {
    constructor(address implementation, address registry, address initialAdmin)
        ResearchEscrowFactory(implementation, registry, initialAdmin)
    {}

    function consumeFundingVoucherFromSenderForTest(
        ResearchEscrowEip712.FundingVoucher memory voucher,
        bytes memory signature
    ) external returns (uint256 budgetUnits) {
        return _consumeFundingVoucher(msg.sender, voucher, signature);
    }
}
