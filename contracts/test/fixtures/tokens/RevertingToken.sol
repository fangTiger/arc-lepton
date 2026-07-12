// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "./MockUSDC.sol";

error RevertingTokenTransferBlocked();

/// @notice 模拟 transfer 与 transferFrom 直接回滚的 ERC-20。
contract RevertingToken is MockUSDC {
    function transfer(address, uint256) public pure override returns (bool) {
        revert RevertingTokenTransferBlocked();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert RevertingTokenTransferBlocked();
    }
}
