// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface Vm {
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
}

contract DataSourceRegistryBindingTest is RoleIsolationFixture {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    bytes32 private constant SOURCE_ID = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;
    address private constant SECOND_PAYOUT = address(0xCA58);

    event FactoryBound(address indexed factory);
    event SourceConfigured(
        bytes32 indexed sourceId, uint64 indexed revision, address payout, uint256 maxUnitPrice, bool active
    );

    function testConstructorFixesOfficialUsdcAndStartsUnbound() public {
        DataSourceRegistry registry = new DataSourceRegistry(REGISTRY_ADMIN);

        assert(registry.usdc() == ARC_TESTNET_USDC);
        assert(registry.factory() == address(0));
    }

    function testBindFactoryRequiresCodeExactWiringAndIsOneTime() public {
        DataSourceRegistry registry = new DataSourceRegistry(address(this));
        MockResearchEscrowFactory factory = new MockResearchEscrowFactory(address(registry), ARC_TESTNET_USDC);

        VM.expectEmit(true, false, false, true, address(registry));
        emit FactoryBound(address(factory));
        registry.bindFactory(address(factory));

        assert(registry.factory() == address(factory));
        _expectRevert(abi.encodeCall(this.callBindFactory, (registry, address(factory))));

        DataSourceRegistry fresh = new DataSourceRegistry(address(this));
        _expectRevert(abi.encodeCall(this.callBindFactory, (fresh, address(0xFACADE))));
        _expectRevert(
            abi.encodeCall(
                this.callBindFactory, (fresh, address(new MockResearchEscrowFactory(address(0xBEEF), ARC_TESTNET_USDC)))
            )
        );
        _expectRevert(
            abi.encodeCall(
                this.callBindFactory, (fresh, address(new MockResearchEscrowFactory(address(fresh), address(0x6))))
            )
        );
    }

    function testSourceWritesAreForbiddenBeforeFactoryBinding() public {
        DataSourceRegistry registry = new DataSourceRegistry(address(this));
        SourceAdminActor sourceAdmin = new SourceAdminActor(registry);

        _expectRevert(abi.encodeCall(this.callGrantSourceAdmin, (registry, address(sourceAdmin))));
        _expectRevert(abi.encodeCall(this.callCreateSource, (sourceAdmin, SOURCE_ID, PAYOUT, uint256(1_000), true)));
    }

    function testSourceAdminCreatesAndUpdatesVersionedSourceAfterBinding() public {
        DataSourceRegistry registry = new DataSourceRegistry(address(this));
        MockResearchEscrowFactory factory = new MockResearchEscrowFactory(address(registry), ARC_TESTNET_USDC);
        SourceAdminActor sourceAdmin = new SourceAdminActor(registry);

        registry.bindFactory(address(factory));
        registry.grantRole(registry.SOURCE_ADMIN_ROLE(), address(sourceAdmin));

        VM.expectEmit(true, true, false, true, address(registry));
        emit SourceConfigured(SOURCE_ID, 1, PAYOUT, 1_000, true);
        sourceAdmin.createSource(SOURCE_ID, PAYOUT, 1_000, true);

        (uint64 revision, address payout, uint256 maxUnitPrice, bool active) = registry.getSource(SOURCE_ID);
        assert(revision == 1);
        assert(payout == PAYOUT);
        assert(maxUnitPrice == 1_000);
        assert(active);

        VM.expectEmit(true, true, false, true, address(registry));
        emit SourceConfigured(SOURCE_ID, 2, SECOND_PAYOUT, 2_000, false);
        sourceAdmin.updateSource(SOURCE_ID, SECOND_PAYOUT, 2_000, false);

        (revision, payout, maxUnitPrice, active) = registry.getSource(SOURCE_ID);
        assert(revision == 2);
        assert(payout == SECOND_PAYOUT);
        assert(maxUnitPrice == 2_000);
        assert(!active);
    }

    function callBindFactory(DataSourceRegistry registry, address factory) external {
        registry.bindFactory(factory);
    }

    function callGrantSourceAdmin(DataSourceRegistry registry, address account) external {
        registry.grantRole(registry.SOURCE_ADMIN_ROLE(), account);
    }

    function callCreateSource(
        SourceAdminActor sourceAdmin,
        bytes32 sourceId,
        address payout,
        uint256 maxUnitPrice,
        bool active
    ) external {
        sourceAdmin.createSource(sourceId, payout, maxUnitPrice, active);
    }

    function _expectRevert(bytes memory callData) private {
        (bool success,) = address(this).call(callData);
        assert(!success);
    }
}

contract SourceAdminActor {
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

contract MockResearchEscrowFactory {
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
