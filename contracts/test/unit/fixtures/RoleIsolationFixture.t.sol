// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RoleIsolationFixture} from "../../fixtures/RoleIsolationFixture.sol";

contract RoleIsolationFixtureTest is RoleIsolationFixture {
    function testRoleAddressesAreNonZero() public pure {
        address[9] memory roles = roleAddresses();

        for (uint256 index = 0; index < roles.length; ++index) {
            assert(roles[index] != address(0));
        }
    }

    function testRoleAddressesArePairwiseDistinct() public pure {
        address[9] memory roles = roleAddresses();

        for (uint256 left = 0; left < roles.length; ++left) {
            for (uint256 right = left + 1; right < roles.length; ++right) {
                assert(roles[left] != roles[right]);
            }
        }
    }
}
