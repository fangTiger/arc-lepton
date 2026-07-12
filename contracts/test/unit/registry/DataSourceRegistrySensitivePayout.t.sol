// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

contract DataSourceRegistrySensitivePayoutTest is RoleIsolationFixture {
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    address private constant ARC_NATIVE_USDC_SYSTEM_EMITTER = address(uint160(type(uint160).max - 1));
    bytes32 private constant SOURCE_ID = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;

    function testRejectsRegistryAddressAsPayoutOnCreateAndUpdate() public {
        (DataSourceRegistry registry, RegistrySensitivePayoutSourceAdminActor sourceAdmin,) = _boundRegistry();

        _assertSensitivePayoutRejected(registry, sourceAdmin, address(registry));
    }

    function testRejectsFactoryAddressAsPayoutOnCreateAndUpdate() public {
        (
            DataSourceRegistry registry,
            RegistrySensitivePayoutSourceAdminActor sourceAdmin,
            RegistrySensitivePayoutMockResearchEscrowFactory factory
        ) = _boundRegistry();

        _assertSensitivePayoutRejected(registry, sourceAdmin, address(factory));
    }

    function testRejectsOfficialUsdcAsPayoutOnCreateAndUpdate() public {
        (DataSourceRegistry registry, RegistrySensitivePayoutSourceAdminActor sourceAdmin,) = _boundRegistry();

        _assertSensitivePayoutRejected(registry, sourceAdmin, ARC_TESTNET_USDC);
    }

    function testRejectsNativeUsdcSystemEmitterAsPayoutOnCreateAndUpdate() public {
        (DataSourceRegistry registry, RegistrySensitivePayoutSourceAdminActor sourceAdmin,) = _boundRegistry();

        _assertSensitivePayoutRejected(registry, sourceAdmin, ARC_NATIVE_USDC_SYSTEM_EMITTER);
    }

    function callCreateSource(
        RegistrySensitivePayoutSourceAdminActor sourceAdmin,
        bytes32 sourceId,
        address payout,
        uint256 maxUnitPrice,
        bool active
    ) external {
        sourceAdmin.createSource(sourceId, payout, maxUnitPrice, active);
    }

    function callUpdateSource(
        RegistrySensitivePayoutSourceAdminActor sourceAdmin,
        bytes32 sourceId,
        address payout,
        uint256 maxUnitPrice,
        bool active
    ) external {
        sourceAdmin.updateSource(sourceId, payout, maxUnitPrice, active);
    }

    function _assertSensitivePayoutRejected(
        DataSourceRegistry registry,
        RegistrySensitivePayoutSourceAdminActor sourceAdmin,
        address sensitivePayout
    ) private {
        _expectRevert(
            abi.encodeCall(this.callCreateSource, (sourceAdmin, SOURCE_ID, sensitivePayout, uint256(1_000), true))
        );

        sourceAdmin.createSource(SOURCE_ID, PAYOUT, 1_000, true);
        _expectRevert(
            abi.encodeCall(this.callUpdateSource, (sourceAdmin, SOURCE_ID, sensitivePayout, uint256(1_000), true))
        );

        (uint64 revision, address payout, uint256 maxUnitPrice, bool active) = registry.getSource(SOURCE_ID);
        assert(revision == 1);
        assert(payout == PAYOUT);
        assert(maxUnitPrice == 1_000);
        assert(active);
    }

    function _boundRegistry()
        private
        returns (
            DataSourceRegistry registry,
            RegistrySensitivePayoutSourceAdminActor sourceAdmin,
            RegistrySensitivePayoutMockResearchEscrowFactory factory
        )
    {
        registry = new DataSourceRegistry(address(this));
        factory = new RegistrySensitivePayoutMockResearchEscrowFactory(address(registry), ARC_TESTNET_USDC);
        sourceAdmin = new RegistrySensitivePayoutSourceAdminActor(registry);

        registry.bindFactory(address(factory));
        registry.grantRole(registry.SOURCE_ADMIN_ROLE(), address(sourceAdmin));
    }

    function _expectRevert(bytes memory callData) private {
        (bool success,) = address(this).call(callData);
        assert(!success);
    }
}

contract RegistrySensitivePayoutSourceAdminActor {
    DataSourceRegistry private immutable REGISTRY;

    constructor(DataSourceRegistry registry) {
        REGISTRY = registry;
    }

    function createSource(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active) external {
        REGISTRY.createSource(sourceId, payout, maxUnitPrice, active);
    }

    function updateSource(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active) external {
        REGISTRY.updateSource(sourceId, payout, maxUnitPrice, active);
    }
}

contract RegistrySensitivePayoutMockResearchEscrowFactory {
    address private immutable REGISTRY;
    address private immutable USDC;

    constructor(address registry_, address usdc_) {
        REGISTRY = registry_;
        USDC = usdc_;
    }

    function registry() external view returns (address) {
        return REGISTRY;
    }

    function usdc() external view returns (address) {
        return USDC;
    }
}
