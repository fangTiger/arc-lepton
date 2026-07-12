// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 仅供合约测试使用的六位精度 USDC。
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }

    /// @notice 测试可按需铸造精确数量的 token units。
    function mint(address account, uint256 value) external {
        _mint(account, value);
    }
}
