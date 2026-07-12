// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library AmountConversions {
    error ZeroAmount();
    error Scale8Truncation(uint256 amountScale8);
    error Native18Truncation(uint256 amountNative18);
    error Uint256Overflow();

    uint256 internal constant SCALE8_PER_UNIT6 = 100;
    uint256 internal constant NATIVE_PER_UNIT6 = 1_000_000_000_000;

    function scale8ToUnits6(uint256 amountScale8) internal pure returns (uint256) {
        _requireNonZero(amountScale8);
        if (amountScale8 % SCALE8_PER_UNIT6 != 0) {
            revert Scale8Truncation(amountScale8);
        }

        return amountScale8 / SCALE8_PER_UNIT6;
    }

    function units6ToScale8(uint256 amountUnits6) internal pure returns (uint256) {
        _requireNonZero(amountUnits6);
        if (amountUnits6 > type(uint256).max / SCALE8_PER_UNIT6) {
            revert Uint256Overflow();
        }

        return amountUnits6 * SCALE8_PER_UNIT6;
    }

    function units6ToNative18(uint256 amountUnits6) internal pure returns (uint256) {
        _requireNonZero(amountUnits6);
        if (amountUnits6 > type(uint256).max / NATIVE_PER_UNIT6) {
            revert Uint256Overflow();
        }

        return amountUnits6 * NATIVE_PER_UNIT6;
    }

    function native18ToUnits6(uint256 amountNative18) internal pure returns (uint256) {
        _requireNonZero(amountNative18);
        if (amountNative18 % NATIVE_PER_UNIT6 != 0) {
            revert Native18Truncation(amountNative18);
        }

        return amountNative18 / NATIVE_PER_UNIT6;
    }

    function native18AmountEqualsUnits6(uint256 amountUnits6, uint256 amountNative18) internal pure returns (bool) {
        if (amountUnits6 == 0 || amountNative18 == 0) {
            return false;
        }
        if (amountUnits6 > type(uint256).max / NATIVE_PER_UNIT6) {
            return false;
        }

        return amountUnits6 * NATIVE_PER_UNIT6 == amountNative18;
    }

    function _requireNonZero(uint256 amount) private pure {
        if (amount == 0) {
            revert ZeroAmount();
        }
    }
}
