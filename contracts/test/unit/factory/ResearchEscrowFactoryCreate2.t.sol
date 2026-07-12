// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

contract ResearchEscrowFactoryCreate2Test is RoleIsolationFixture {
    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    uint256 private constant INITIAL_BUDGET = 1_000_000;
    uint64 private constant EXPECTED_EXPIRES_AT = 2_000_000_000;
    uint64 private constant ACTIVATION_CUTOFF = 1_999_996_400;

    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    address private constant SECOND_BUYER = address(0xB002);

    function testConstructorFixesImplementationRegistryAndOfficialUsdc() public {
        (ResearchEscrow implementation, DataSourceRegistry registry, ResearchEscrowFactoryHarness factory) =
            _boundFactory();

        assert(factory.implementation() == address(implementation));
        assert(factory.registry() == address(registry));
        assert(factory.usdc() == ARC_TESTNET_USDC);
        assert(registry.factory() == address(factory));
    }

    function testPredictsAndCreatesEip1167CloneAtCreate2Address() public {
        (ResearchEscrow implementation,, ResearchEscrowFactoryHarness factory) = _boundFactory();

        bytes32 expectedSalt = keccak256(abi.encode(BUYER, RESEARCH_KEY));
        assert(factory.saltFor(BUYER, RESEARCH_KEY) == expectedSalt);

        address predicted = factory.predictEscrow(BUYER, RESEARCH_KEY);
        assert(predicted != address(0));
        assert(predicted.code.length == 0);

        address actual = factory.createEscrowForTest(
            BUYER, RESEARCH_KEY, INITIAL_BUDGET, EXPECTED_EXPIRES_AT, ACTIVATION_CUTOFF, INTENT_SIGNER
        );
        assert(actual == predicted);
        assert(factory.escrowOf(BUYER, RESEARCH_KEY) == actual);
        assert(keccak256(actual.code) == keccak256(_minimalProxyRuntime(address(implementation))));
    }

    function testSameResearchKeyIsIsolatedByBuyer() public {
        (,, ResearchEscrowFactoryHarness factory) = _boundFactory();

        address firstPredicted = factory.predictEscrow(BUYER, RESEARCH_KEY);
        address secondPredicted = factory.predictEscrow(SECOND_BUYER, RESEARCH_KEY);
        assert(firstPredicted != secondPredicted);

        address first = factory.createEscrowForTest(
            BUYER, RESEARCH_KEY, INITIAL_BUDGET, EXPECTED_EXPIRES_AT, ACTIVATION_CUTOFF, INTENT_SIGNER
        );
        address second = factory.createEscrowForTest(
            SECOND_BUYER, RESEARCH_KEY, INITIAL_BUDGET, EXPECTED_EXPIRES_AT, ACTIVATION_CUTOFF, INTENT_SIGNER
        );

        assert(first == firstPredicted);
        assert(second == secondPredicted);
        assert(factory.escrowOf(BUYER, RESEARCH_KEY) == first);
        assert(factory.escrowOf(SECOND_BUYER, RESEARCH_KEY) == second);
    }

    function testRejectsZeroResearchKeyForPredictionAndCreation() public {
        (,, ResearchEscrowFactoryHarness factory) = _boundFactory();

        _expectRevert(abi.encodeCall(this.callSaltFor, (factory, BUYER, bytes32(0))));
        _expectRevert(abi.encodeCall(this.callPredictEscrow, (factory, BUYER, bytes32(0))));
        _expectRevert(
            abi.encodeCall(
                this.callCreateEscrowForTest,
                (factory, BUYER, bytes32(0), INITIAL_BUDGET, EXPECTED_EXPIRES_AT, ACTIVATION_CUTOFF, INTENT_SIGNER)
            )
        );
    }

    function testImplementationInitializerIsLocked() public {
        (ResearchEscrow implementation, DataSourceRegistry registry, ResearchEscrowFactoryHarness factory) =
            _boundFactory();

        _expectRevert(
            abi.encodeCall(
                this.callInitializeImplementation,
                (
                    implementation,
                    address(factory),
                    address(registry),
                    ARC_TESTNET_USDC,
                    BUYER,
                    RESEARCH_KEY,
                    INITIAL_BUDGET,
                    EXPECTED_EXPIRES_AT,
                    ACTIVATION_CUTOFF,
                    INTENT_SIGNER
                )
            )
        );
    }

    function callSaltFor(ResearchEscrowFactoryHarness factory, address buyer, bytes32 researchKey)
        external
        pure
        returns (bytes32)
    {
        return factory.saltFor(buyer, researchKey);
    }

    function callPredictEscrow(ResearchEscrowFactoryHarness factory, address buyer, bytes32 researchKey)
        external
        view
        returns (address)
    {
        return factory.predictEscrow(buyer, researchKey);
    }

    function callCreateEscrowForTest(
        ResearchEscrowFactoryHarness factory,
        address buyer,
        bytes32 researchKey,
        uint256 initialBudget,
        uint64 expectedExpiresAt,
        uint64 activationCutoff,
        address plannedIntentSigner
    ) external returns (address) {
        return factory.createEscrowForTest(
            buyer, researchKey, initialBudget, expectedExpiresAt, activationCutoff, plannedIntentSigner
        );
    }

    function callInitializeImplementation(
        ResearchEscrow implementation,
        address factory,
        address registry,
        address usdc,
        address buyer,
        bytes32 researchKey,
        uint256 initialBudget,
        uint64 expectedExpiresAt,
        uint64 activationCutoff,
        address plannedIntentSigner
    ) external {
        implementation.initialize(
            factory,
            registry,
            usdc,
            buyer,
            researchKey,
            initialBudget,
            expectedExpiresAt,
            activationCutoff,
            plannedIntentSigner
        );
    }

    function _boundFactory()
        private
        returns (ResearchEscrow implementation, DataSourceRegistry registry, ResearchEscrowFactoryHarness factory)
    {
        implementation = new ResearchEscrow();
        registry = new DataSourceRegistry(address(this));
        factory = new ResearchEscrowFactoryHarness(address(implementation), address(registry), FACTORY_ADMIN);
        registry.bindFactory(address(factory));
    }

    function _minimalProxyRuntime(address implementation) private pure returns (bytes memory) {
        return abi.encodePacked(hex"363d3d373d3d3d363d73", bytes20(implementation), hex"5af43d82803e903d91602b57fd5bf3");
    }

    function _expectRevert(bytes memory callData) private {
        (bool success,) = address(this).call(callData);
        assert(!success);
    }
}

contract ResearchEscrowFactoryHarness is ResearchEscrowFactory {
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
