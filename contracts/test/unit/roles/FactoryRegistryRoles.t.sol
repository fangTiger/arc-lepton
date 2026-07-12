// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ResearchEscrow} from "../../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../../src/factory/ResearchEscrowFactory.sol";
import {DataSourceRegistry} from "../../../src/registry/DataSourceRegistry.sol";
import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);

interface RolesVm {
    function expectPartialRevert(bytes4 revertData) external;
    function prank(address sender) external;
}

interface IRoleEnumerable {
    function hasRole(bytes32 role, address account) external view returns (bool);
    function getRoleAdmin(bytes32 role) external view returns (bytes32);
    function getRoleMember(bytes32 role, uint256 index) external view returns (address);
    function getRoleMemberCount(bytes32 role) external view returns (uint256);
}

contract FactoryRegistryRolesTest is RoleIsolationFixture {
    RolesVm private constant VM = RolesVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct RoleSystem {
        ResearchEscrow implementation;
        DataSourceRegistry registry;
        ResearchEscrowFactory factory;
    }

    function testBoundRoleMembersAndAdminGraphAreEnumerable() public {
        RoleSystem memory system = _governanceSystem();

        bytes32 defaultAdminRole = system.factory.DEFAULT_ADMIN_ROLE();
        bytes32 sourceAdminRole = system.registry.SOURCE_ADMIN_ROLE();
        bytes32 fundingSignerRole = system.factory.FUNDING_SIGNER_ROLE();
        bytes32 intentSignerRole = system.factory.INTENT_SIGNER_ROLE();
        bytes32 settlerRole = system.factory.SETTLER_ROLE();

        assert(system.registry.factory() == address(system.factory));
        assert(system.factory.registry() == address(system.registry));
        assert(system.factory.usdc() == system.registry.usdc());

        _assertSingleRoleMember(IRoleEnumerable(address(system.factory)), defaultAdminRole, FACTORY_ADMIN);
        _assertSingleRoleMember(IRoleEnumerable(address(system.factory)), fundingSignerRole, FUNDING_SIGNER);
        _assertSingleRoleMember(IRoleEnumerable(address(system.factory)), intentSignerRole, INTENT_SIGNER);
        _assertSingleRoleMember(IRoleEnumerable(address(system.factory)), settlerRole, SETTLER);
        _assertSingleRoleMember(IRoleEnumerable(address(system.registry)), defaultAdminRole, REGISTRY_ADMIN);
        _assertSingleRoleMember(IRoleEnumerable(address(system.registry)), sourceAdminRole, SOURCE_ADMIN);

        assert(system.factory.getRoleAdmin(defaultAdminRole) == defaultAdminRole);
        assert(system.factory.getRoleAdmin(fundingSignerRole) == defaultAdminRole);
        assert(system.factory.getRoleAdmin(intentSignerRole) == defaultAdminRole);
        assert(system.factory.getRoleAdmin(settlerRole) == defaultAdminRole);
        assert(system.registry.getRoleAdmin(defaultAdminRole) == defaultAdminRole);
        assert(system.registry.getRoleAdmin(sourceAdminRole) == defaultAdminRole);
    }

    function testFactoryAndRegistryGovernanceAreSeparated() public {
        RoleSystem memory system = _governanceSystem();

        bytes32 defaultAdminRole = system.factory.DEFAULT_ADMIN_ROLE();
        bytes32 sourceAdminRole = system.registry.SOURCE_ADMIN_ROLE();
        bytes32 settlerRole = system.factory.SETTLER_ROLE();

        assert(FACTORY_ADMIN != REGISTRY_ADMIN);
        assert(system.factory.hasRole(defaultAdminRole, FACTORY_ADMIN));
        assert(!system.factory.hasRole(defaultAdminRole, REGISTRY_ADMIN));
        assert(system.registry.hasRole(defaultAdminRole, REGISTRY_ADMIN));
        assert(!system.registry.hasRole(defaultAdminRole, FACTORY_ADMIN));

        VM.prank(FACTORY_ADMIN);
        VM.expectPartialRevert(AccessControlUnauthorizedAccount.selector);
        system.registry.grantRole(sourceAdminRole, FACTORY_ADMIN);

        VM.prank(REGISTRY_ADMIN);
        VM.expectPartialRevert(AccessControlUnauthorizedAccount.selector);
        system.factory.grantRole(settlerRole, REGISTRY_ADMIN);
    }

    function testRegistryRejectsGrantingSensitiveRoleToFactoryRoleMembers() public {
        RoleSystem memory system = _governanceSystem();

        bytes32[] memory registryRoles = _registrySensitiveRoles(system.registry);
        address[] memory factoryMembers = _factorySensitiveMembers();

        for (uint256 roleIndex = 0; roleIndex < registryRoles.length; ++roleIndex) {
            for (uint256 memberIndex = 0; memberIndex < factoryMembers.length; ++memberIndex) {
                VM.prank(REGISTRY_ADMIN);
                VM.expectPartialRevert(DataSourceRegistry.SensitiveRoleConflict.selector);
                system.registry.grantRole(registryRoles[roleIndex], factoryMembers[memberIndex]);
            }
        }
    }

    function testFactoryRejectsGrantingSensitiveRoleToRegistryRoleMembers() public {
        RoleSystem memory system = _governanceSystem();

        bytes32[] memory factoryRoles = _factorySensitiveRoles(system.factory);
        address[] memory registryMembers = _registrySensitiveMembers();

        for (uint256 roleIndex = 0; roleIndex < factoryRoles.length; ++roleIndex) {
            for (uint256 memberIndex = 0; memberIndex < registryMembers.length; ++memberIndex) {
                VM.prank(FACTORY_ADMIN);
                VM.expectPartialRevert(ResearchEscrowFactory.SensitiveRoleConflict.selector);
                system.factory.grantRole(factoryRoles[roleIndex], registryMembers[memberIndex]);
            }
        }
    }

    function testSameAuthorityRejectsDoubleSensitiveRoleGrants() public {
        RoleSystem memory system = _governanceSystem();
        bytes32 settlerRole = system.factory.SETTLER_ROLE();
        bytes32 sourceAdminRole = system.registry.SOURCE_ADMIN_ROLE();

        VM.prank(FACTORY_ADMIN);
        VM.expectPartialRevert(ResearchEscrowFactory.SensitiveRoleConflict.selector);
        system.factory.grantRole(settlerRole, FUNDING_SIGNER);

        VM.prank(REGISTRY_ADMIN);
        VM.expectPartialRevert(DataSourceRegistry.SensitiveRoleConflict.selector);
        system.registry.grantRole(sourceAdminRole, REGISTRY_ADMIN);
    }

    function _governanceSystem() private returns (RoleSystem memory system) {
        system.implementation = new ResearchEscrow();
        system.registry = new DataSourceRegistry(DEPLOYMENT_KEY);
        system.factory =
            new ResearchEscrowFactory(address(system.implementation), address(system.registry), DEPLOYMENT_KEY);

        bytes32 defaultAdminRole = system.factory.DEFAULT_ADMIN_ROLE();
        bytes32 fundingSignerRole = system.factory.FUNDING_SIGNER_ROLE();
        bytes32 intentSignerRole = system.factory.INTENT_SIGNER_ROLE();
        bytes32 settlerRole = system.factory.SETTLER_ROLE();
        bytes32 sourceAdminRole = system.registry.SOURCE_ADMIN_ROLE();

        VM.prank(DEPLOYMENT_KEY);
        system.registry.bindFactory(address(system.factory));

        VM.prank(DEPLOYMENT_KEY);
        system.factory.grantRole(defaultAdminRole, FACTORY_ADMIN);
        VM.prank(DEPLOYMENT_KEY);
        system.registry.grantRole(defaultAdminRole, REGISTRY_ADMIN);
        VM.prank(DEPLOYMENT_KEY);
        system.factory.grantRole(fundingSignerRole, FUNDING_SIGNER);
        VM.prank(DEPLOYMENT_KEY);
        system.factory.grantRole(intentSignerRole, INTENT_SIGNER);
        VM.prank(DEPLOYMENT_KEY);
        system.factory.grantRole(settlerRole, SETTLER);
        VM.prank(REGISTRY_ADMIN);
        system.registry.grantRole(sourceAdminRole, SOURCE_ADMIN);

        VM.prank(FACTORY_ADMIN);
        system.factory.revokeRole(defaultAdminRole, DEPLOYMENT_KEY);
        VM.prank(REGISTRY_ADMIN);
        system.registry.revokeRole(defaultAdminRole, DEPLOYMENT_KEY);
    }

    function _assertSingleRoleMember(IRoleEnumerable authority, bytes32 role, address expectedMember) private view {
        assert(authority.hasRole(role, expectedMember));
        assert(authority.getRoleMemberCount(role) == 1);
        assert(authority.getRoleMember(role, 0) == expectedMember);
    }

    function _factorySensitiveRoles(ResearchEscrowFactory factory) private view returns (bytes32[] memory roles) {
        roles = new bytes32[](4);
        roles[0] = factory.DEFAULT_ADMIN_ROLE();
        roles[1] = factory.FUNDING_SIGNER_ROLE();
        roles[2] = factory.INTENT_SIGNER_ROLE();
        roles[3] = factory.SETTLER_ROLE();
    }

    function _registrySensitiveRoles(DataSourceRegistry registry) private view returns (bytes32[] memory roles) {
        roles = new bytes32[](2);
        roles[0] = registry.DEFAULT_ADMIN_ROLE();
        roles[1] = registry.SOURCE_ADMIN_ROLE();
    }

    function _factorySensitiveMembers() private pure returns (address[] memory members) {
        members = new address[](4);
        members[0] = FACTORY_ADMIN;
        members[1] = FUNDING_SIGNER;
        members[2] = INTENT_SIGNER;
        members[3] = SETTLER;
    }

    function _registrySensitiveMembers() private pure returns (address[] memory members) {
        members = new address[](2);
        members[0] = REGISTRY_ADMIN;
        members[1] = SOURCE_ADMIN;
    }
}
