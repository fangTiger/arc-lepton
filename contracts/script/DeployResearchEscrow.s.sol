// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataSourceRegistry} from "../src/registry/DataSourceRegistry.sol";
import {ResearchEscrow} from "../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../src/factory/ResearchEscrowFactory.sol";

interface Vm {
    function envAddress(string calldata key) external returns (address);
    function startBroadcast(address account) external;
    function stopBroadcast() external;
}

contract DeployResearchEscrowScript {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct CoreDeployment {
        DataSourceRegistry registry;
        ResearchEscrow implementation;
        ResearchEscrowFactory factory;
    }

    struct RoleConfig {
        address factoryGovernance;
        address registryGovernance;
        address sourceAdmin;
        address fundingSigner;
        address intentSigner;
        address settler;
    }

    struct SourceConfig {
        bytes32 sourceId;
        address payout;
        uint256 maxUnitPrice;
        bool active;
    }

    function run()
        external
        returns (DataSourceRegistry registry, ResearchEscrow implementation, ResearchEscrowFactory factory)
    {
        address initialAdmin = VM.envAddress("ARC_DEPLOYER");

        VM.startBroadcast(initialAdmin);
        CoreDeployment memory deployment = deployCore(initialAdmin);
        VM.stopBroadcast();

        return (deployment.registry, deployment.implementation, deployment.factory);
    }

    function deployCore(address initialAdmin) public returns (CoreDeployment memory deployment) {
        DataSourceRegistry registry = new DataSourceRegistry(initialAdmin);
        ResearchEscrow implementation = new ResearchEscrow();
        ResearchEscrowFactory factory =
            new ResearchEscrowFactory(address(implementation), address(registry), initialAdmin);

        registry.bindFactory(address(factory));

        deployment = CoreDeployment({registry: registry, implementation: implementation, factory: factory});
    }

    function transferRolesFromEnv(address registryAddress, address factoryAddress) external {
        address initialAdmin = VM.envAddress("ARC_DEPLOYER");
        RoleConfig memory roles = _roleConfigFromEnv();

        VM.startBroadcast(initialAdmin);
        transferRoles(registryAddress, factoryAddress, initialAdmin, roles);
        VM.stopBroadcast();
    }

    function transferRoles(CoreDeployment memory deployment, address initialAdmin, RoleConfig memory roles) public {
        transferRoles(address(deployment.registry), address(deployment.factory), initialAdmin, roles);
    }

    function transferRoles(
        address registryAddress,
        address factoryAddress,
        address initialAdmin,
        RoleConfig memory roles
    ) public {
        DataSourceRegistry registry = DataSourceRegistry(registryAddress);
        ResearchEscrowFactory factory = ResearchEscrowFactory(factoryAddress);

        factory.grantRole(factory.DEFAULT_ADMIN_ROLE(), roles.factoryGovernance);
        factory.grantRole(factory.FUNDING_SIGNER_ROLE(), roles.fundingSigner);
        factory.grantRole(factory.INTENT_SIGNER_ROLE(), roles.intentSigner);
        factory.grantRole(factory.SETTLER_ROLE(), roles.settler);

        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), roles.registryGovernance);
        registry.grantRole(registry.SOURCE_ADMIN_ROLE(), roles.sourceAdmin);

        factory.revokeRole(factory.DEFAULT_ADMIN_ROLE(), initialAdmin);
        registry.revokeRole(registry.DEFAULT_ADMIN_ROLE(), initialAdmin);
    }

    function configureSource(address registryAddress, address sourceAdmin, SourceConfig calldata source) external {
        VM.startBroadcast(sourceAdmin);
        DataSourceRegistry(registryAddress)
            .createSource(source.sourceId, source.payout, source.maxUnitPrice, source.active);
        VM.stopBroadcast();
    }

    function _roleConfigFromEnv() private returns (RoleConfig memory roles) {
        roles = RoleConfig({
            factoryGovernance: VM.envAddress("ARC_FACTORY_GOVERNANCE"),
            registryGovernance: VM.envAddress("ARC_REGISTRY_GOVERNANCE"),
            sourceAdmin: VM.envAddress("ARC_SOURCE_ADMIN"),
            fundingSigner: VM.envAddress("ARC_FUNDING_SIGNER"),
            intentSigner: VM.envAddress("ARC_INTENT_SIGNER"),
            settler: VM.envAddress("ARC_SETTLER")
        });
    }
}
