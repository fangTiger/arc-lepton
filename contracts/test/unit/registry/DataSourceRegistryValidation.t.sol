// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

contract DataSourceRegistryValidationTest is RoleIsolationFixture {
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    bytes32 private constant SOURCE_ID = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;
    bytes32 private constant SECOND_SOURCE_ID = 0xe767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;

    function testRejectsZeroSourceIdPayoutAndMaxUnitPrice() public {
        (DataSourceRegistry registry, RegistryValidationSourceAdminActor sourceAdmin) = _boundRegistry();

        _expectRevert(abi.encodeCall(this.callCreateSource, (sourceAdmin, bytes32(0), PAYOUT, uint256(1_000), true)));
        _expectRevert(abi.encodeCall(this.callCreateSource, (sourceAdmin, SOURCE_ID, address(0), uint256(1_000), true)));
        _expectRevert(abi.encodeCall(this.callCreateSource, (sourceAdmin, SOURCE_ID, PAYOUT, uint256(0), true)));

        sourceAdmin.createSource(SOURCE_ID, PAYOUT, 1_000, true);

        _expectRevert(abi.encodeCall(this.callUpdateSource, (sourceAdmin, bytes32(0), PAYOUT, uint256(1_000), true)));
        _expectRevert(abi.encodeCall(this.callUpdateSource, (sourceAdmin, SOURCE_ID, address(0), uint256(1_000), true)));
        _expectRevert(abi.encodeCall(this.callUpdateSource, (sourceAdmin, SOURCE_ID, PAYOUT, uint256(0), true)));

        (uint64 revision, address payout, uint256 maxUnitPrice, bool active) = registry.getSource(SOURCE_ID);
        assert(revision == 1);
        assert(payout == PAYOUT);
        assert(maxUnitPrice == 1_000);
        assert(active);
    }

    function testRejectsDuplicateCreateAndMissingUpdate() public {
        (, RegistryValidationSourceAdminActor sourceAdmin) = _boundRegistry();

        sourceAdmin.createSource(SOURCE_ID, PAYOUT, 1_000, true);

        _expectRevert(abi.encodeCall(this.callCreateSource, (sourceAdmin, SOURCE_ID, PAYOUT, uint256(1_000), true)));
        _expectRevert(
            abi.encodeCall(this.callUpdateSource, (sourceAdmin, SECOND_SOURCE_ID, PAYOUT, uint256(1_000), true))
        );
    }

    function testCreateSourceRequiresInitiallyActive() public {
        (, RegistryValidationSourceAdminActor sourceAdmin) = _boundRegistry();

        _expectRevert(abi.encodeCall(this.callCreateSource, (sourceAdmin, SOURCE_ID, PAYOUT, uint256(1_000), false)));
    }

    function testRejectsUnauthorizedCreateAndUpdate() public {
        (DataSourceRegistry registry, RegistryValidationSourceAdminActor sourceAdmin) = _boundRegistry();
        RegistryValidationSourceAdminActor unauthorized = new RegistryValidationSourceAdminActor(registry);

        _expectRevert(abi.encodeCall(this.callCreateSource, (unauthorized, SOURCE_ID, PAYOUT, uint256(1_000), true)));

        sourceAdmin.createSource(SOURCE_ID, PAYOUT, 1_000, true);
        _expectRevert(abi.encodeCall(this.callUpdateSource, (unauthorized, SOURCE_ID, PAYOUT, uint256(2_000), false)));
    }

    function testDeactivatedSourceIdCannotBeDeletedOrReusedAsNew() public {
        (DataSourceRegistry registry, RegistryValidationSourceAdminActor sourceAdmin) = _boundRegistry();

        sourceAdmin.createSource(SOURCE_ID, PAYOUT, 1_000, true);
        sourceAdmin.updateSource(SOURCE_ID, PAYOUT, 1_000, false);

        (uint64 revision, address payout, uint256 maxUnitPrice, bool active) = registry.getSource(SOURCE_ID);
        assert(revision == 2);
        assert(payout == PAYOUT);
        assert(maxUnitPrice == 1_000);
        assert(!active);

        _expectRevert(abi.encodeCall(this.callCreateSource, (sourceAdmin, SOURCE_ID, PAYOUT, uint256(1_000), true)));

        sourceAdmin.updateSource(SOURCE_ID, PAYOUT, 2_000, true);
        (revision, payout, maxUnitPrice, active) = registry.getSource(SOURCE_ID);
        assert(revision == 3);
        assert(payout == PAYOUT);
        assert(maxUnitPrice == 2_000);
        assert(active);
    }

    function testRejectsRevisionOverflow() public {
        DataSourceRegistryHarness registry = new DataSourceRegistryHarness(address(this));
        RegistryValidationMockResearchEscrowFactory factory =
            new RegistryValidationMockResearchEscrowFactory(address(registry), ARC_TESTNET_USDC);
        RegistryValidationSourceAdminActor sourceAdmin = new RegistryValidationSourceAdminActor(registry);

        registry.bindFactory(address(factory));
        registry.grantRole(registry.SOURCE_ADMIN_ROLE(), address(sourceAdmin));
        registry.forceSourceForTest(SOURCE_ID, PAYOUT, 1_000, true, type(uint64).max);

        _expectRevert(abi.encodeCall(this.callUpdateSource, (sourceAdmin, SOURCE_ID, PAYOUT, uint256(2_000), true)));
    }

    function callCreateSource(
        RegistryValidationSourceAdminActor sourceAdmin,
        bytes32 sourceId,
        address payout,
        uint256 maxUnitPrice,
        bool active
    ) external {
        sourceAdmin.createSource(sourceId, payout, maxUnitPrice, active);
    }

    function callUpdateSource(
        RegistryValidationSourceAdminActor sourceAdmin,
        bytes32 sourceId,
        address payout,
        uint256 maxUnitPrice,
        bool active
    ) external {
        sourceAdmin.updateSource(sourceId, payout, maxUnitPrice, active);
    }

    function _boundRegistry()
        private
        returns (DataSourceRegistry registry, RegistryValidationSourceAdminActor sourceAdmin)
    {
        registry = new DataSourceRegistry(address(this));
        RegistryValidationMockResearchEscrowFactory factory =
            new RegistryValidationMockResearchEscrowFactory(address(registry), ARC_TESTNET_USDC);
        sourceAdmin = new RegistryValidationSourceAdminActor(registry);

        registry.bindFactory(address(factory));
        registry.grantRole(registry.SOURCE_ADMIN_ROLE(), address(sourceAdmin));
    }

    function _expectRevert(bytes memory callData) private {
        (bool success,) = address(this).call(callData);
        assert(!success);
    }
}

contract DataSourceRegistryHarness is DataSourceRegistry {
    constructor(address initialAdmin) DataSourceRegistry(initialAdmin) {}

    function forceSourceForTest(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active, uint64 revision)
        external
    {
        _forceSourceForTest(sourceId, payout, maxUnitPrice, active, revision);
    }
}

contract RegistryValidationSourceAdminActor {
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

contract RegistryValidationMockResearchEscrowFactory {
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
