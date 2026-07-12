// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract ToolchainBaselineTest {
    function testOpenZeppelinMathUsesPinnedToolchain() public pure {
        uint256 scaledValue = Math.mulDiv(6, 7, 3);

        assert(scaledValue == 14);
    }
}
