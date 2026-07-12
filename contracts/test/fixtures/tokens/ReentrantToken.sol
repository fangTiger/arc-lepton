// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice 在普通转账后执行一次可配置回调的恶意 ERC-20 测试夹具。
contract ReentrantToken is MockUSDC {
    address public callbackTarget;
    bytes public callbackData;

    bool private callbackEntered;

    /// @notice 配置后续 transfer/transferFrom 普通转账触发的回调。
    function configureCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function _update(address from, address to, uint256 value) internal override {
        bool shouldCallback = from != address(0) && to != address(0) && callbackTarget != address(0) && !callbackEntered;

        super._update(from, to, value);

        if (!shouldCallback) {
            return;
        }

        callbackEntered = true;
        (bool success, bytes memory revertData) = callbackTarget.call(callbackData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(revertData, 0x20), mload(revertData))
            }
        }
        callbackEntered = false;
    }
}
