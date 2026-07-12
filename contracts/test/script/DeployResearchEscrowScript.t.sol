// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DeployResearchEscrowScript} from "../../script/DeployResearchEscrow.s.sol";
import {DataSourceRegistry} from "../../src/registry/DataSourceRegistry.sol";
import {ResearchEscrow} from "../../src/escrow/ResearchEscrow.sol";
import {ResearchEscrowFactory} from "../../src/factory/ResearchEscrowFactory.sol";

interface ScriptBoundaryVm {
    function setEnv(string calldata key, string calldata value) external;
}

contract DeployResearchEscrowScriptTest {
    ScriptBoundaryVm private constant VM =
        ScriptBoundaryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant DEPLOYER = 0x81d48d2c5D0744e8eF7A5c35cDceB0A27A1c707B;

    function testRunOnlyDeploysCoreContractsAndKeepsRoleStageUnchanged() public {
        VM.setEnv("ARC_DEPLOYER", "0x81d48d2c5D0744e8eF7A5c35cDceB0A27A1c707B");

        DeployResearchEscrowScript script = new DeployResearchEscrowScript();
        (DataSourceRegistry registry, ResearchEscrow implementation, ResearchEscrowFactory factory) = script.run();

        assert(address(registry) != address(0));
        assert(address(implementation) != address(0));
        assert(address(factory) != address(0));
        assert(registry.factory() == address(factory));
        assert(factory.registry() == address(registry));
        assert(factory.implementation() == address(implementation));

        bytes32 defaultAdminRole = factory.DEFAULT_ADMIN_ROLE();
        assert(factory.hasRole(defaultAdminRole, DEPLOYER));
        assert(registry.hasRole(defaultAdminRole, DEPLOYER));
        assert(factory.getRoleMemberCount(defaultAdminRole) == 1);
        assert(registry.getRoleMemberCount(defaultAdminRole) == 1);

        assert(factory.getRoleMemberCount(factory.FUNDING_SIGNER_ROLE()) == 0);
        assert(factory.getRoleMemberCount(factory.INTENT_SIGNER_ROLE()) == 0);
        assert(factory.getRoleMemberCount(factory.SETTLER_ROLE()) == 0);
        assert(registry.getRoleMemberCount(registry.SOURCE_ADMIN_ROLE()) == 0);
    }
}
