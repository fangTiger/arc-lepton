// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

interface V1ImmutabilityVm {
    function prank(address sender) external;
}

contract ResearchEscrowFactoryV1ImmutabilityTest is RoleIsolationFixture {
    V1ImmutabilityVm private constant VM = V1ImmutabilityVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    uint256 private constant INITIAL_BUDGET = 1_000_000;
    uint64 private constant EXPECTED_EXPIRES_AT = 2_000_000_000;
    uint64 private constant ACTIVATION_CUTOFF = 1_999_996_400;

    function testCommonUpgradeSelectorsCannotReplaceFactoryImplementation() public {
        (ResearchEscrow implementation,, ResearchEscrowFactoryImmutabilityHarness factory) = _boundFactory();
        ResearchEscrow replacement = new ResearchEscrow();
        address originalImplementation = address(implementation);
        address predictedBefore = factory.predictEscrow(BUYER, RESEARCH_KEY);
        address clone = factory.createEscrowForTest(
            BUYER, RESEARCH_KEY, INITIAL_BUDGET, EXPECTED_EXPIRES_AT, ACTIVATION_CUTOFF, INTENT_SIGNER
        );

        assert(clone == predictedBefore);
        _assertFactoryAndCloneStillPinned(factory, originalImplementation, predictedBefore, clone);

        _assertUpgradeSelectorHasNoEffect(
            factory,
            abi.encodeWithSignature("upgradeTo(address)", address(replacement)),
            originalImplementation,
            predictedBefore,
            clone
        );
        _assertUpgradeSelectorHasNoEffect(
            factory,
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(replacement), ""),
            originalImplementation,
            predictedBefore,
            clone
        );
        _assertUpgradeSelectorHasNoEffect(
            factory,
            abi.encodeWithSignature("setImplementation(address)", address(replacement)),
            originalImplementation,
            predictedBefore,
            clone
        );
        _assertUpgradeSelectorHasNoEffect(
            factory,
            abi.encodeWithSignature("changeImplementation(address)", address(replacement)),
            originalImplementation,
            predictedBefore,
            clone
        );
        _assertUpgradeSelectorHasNoEffect(
            factory,
            abi.encodeWithSignature("updateImplementation(address)", address(replacement)),
            originalImplementation,
            predictedBefore,
            clone
        );
    }

    function testNewImplementationRequiresNewFactoryAndManifestLineage() public {
        (
            ResearchEscrow implementationV1,
            DataSourceRegistry registryV1,
            ResearchEscrowFactoryImmutabilityHarness factoryV1
        ) = _boundFactory();
        address predictedV1 = factoryV1.predictEscrow(BUYER, RESEARCH_KEY);
        address cloneV1 = factoryV1.createEscrowForTest(
            BUYER, RESEARCH_KEY, INITIAL_BUDGET, EXPECTED_EXPIRES_AT, ACTIVATION_CUTOFF, INTENT_SIGNER
        );

        (
            ResearchEscrow implementationV2,
            DataSourceRegistry registryV2,
            ResearchEscrowFactoryImmutabilityHarness factoryV2
        ) = _boundFactory();
        address predictedV2 = factoryV2.predictEscrow(BUYER, RESEARCH_KEY);
        address cloneV2 = factoryV2.createEscrowForTest(
            BUYER, RESEARCH_KEY, INITIAL_BUDGET, EXPECTED_EXPIRES_AT, ACTIVATION_CUTOFF, INTENT_SIGNER
        );

        assert(predictedV1 == cloneV1);
        assert(predictedV2 == cloneV2);
        assert(predictedV1 != predictedV2);

        assert(factoryV1.implementation() == address(implementationV1));
        assert(factoryV2.implementation() == address(implementationV2));
        assert(factoryV1.registry() == address(registryV1));
        assert(factoryV2.registry() == address(registryV2));
        assert(registryV1.factory() == address(factoryV1));
        assert(registryV2.factory() == address(factoryV2));

        assert(keccak256(cloneV1.code) == keccak256(_minimalProxyRuntime(address(implementationV1))));
        assert(keccak256(cloneV2.code) == keccak256(_minimalProxyRuntime(address(implementationV2))));
        assert(keccak256(cloneV1.code) != keccak256(cloneV2.code));
    }

    function _boundFactory()
        private
        returns (
            ResearchEscrow implementation,
            DataSourceRegistry registry,
            ResearchEscrowFactoryImmutabilityHarness factory
        )
    {
        implementation = new ResearchEscrow();
        registry = new DataSourceRegistry(FACTORY_ADMIN);
        factory =
            new ResearchEscrowFactoryImmutabilityHarness(address(implementation), address(registry), FACTORY_ADMIN);
        VM.prank(FACTORY_ADMIN);
        registry.bindFactory(address(factory));
    }

    function _assertUpgradeSelectorHasNoEffect(
        ResearchEscrowFactoryImmutabilityHarness factory,
        bytes memory callData,
        address originalImplementation,
        address predictedBefore,
        address clone
    ) private {
        VM.prank(FACTORY_ADMIN);
        (bool success,) = address(factory).call(callData);

        assert(!success);
        _assertFactoryAndCloneStillPinned(factory, originalImplementation, predictedBefore, clone);
    }

    function _assertFactoryAndCloneStillPinned(
        ResearchEscrowFactoryImmutabilityHarness factory,
        address expectedImplementation,
        address predictedBefore,
        address clone
    ) private view {
        assert(factory.implementation() == expectedImplementation);
        assert(factory.predictEscrow(BUYER, RESEARCH_KEY) == predictedBefore);
        assert(keccak256(clone.code) == keccak256(_minimalProxyRuntime(expectedImplementation)));
    }

    function _minimalProxyRuntime(address implementation) private pure returns (bytes memory) {
        return abi.encodePacked(hex"363d3d373d3d3d363d73", bytes20(implementation), hex"5af43d82803e903d91602b57fd5bf3");
    }
}

contract ResearchEscrowFactoryImmutabilityHarness is ResearchEscrowFactory {
    constructor(address implementation, address registry, address initialAdmin)
        ResearchEscrowFactory(implementation, registry, initialAdmin)
    {}

    function createEscrowForTest(
        address buyer,
        bytes32 researchKey,
        uint256 initialBudget,
        uint64 expectedExpiresAt,
        uint64 activationCutoff,
        address plannedIntentSigner
    ) external returns (address) {
        return _createEscrow(
            buyer, researchKey, initialBudget, expectedExpiresAt, activationCutoff, plannedIntentSigner
        );
    }
}
