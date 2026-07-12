// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {MockUSDC} from "./MockUSDC.sol";

/// @notice 普通非零转账按 100 bps 向上取整并至少燃烧 1 unit 的六位精度测试 token。
contract FeeOnTransferToken is MockUSDC {
    uint256 public constant FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice 暴露 burn 以验证 mint/burn 路径不会进入转账收费逻辑。
    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || value == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = Math.mulDiv(value, FEE_BPS, BPS_DENOMINATOR, Math.Rounding.Ceil);
        super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}
