// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AmountConversions} from "../../../src/canonical/AmountConversions.sol";

contract AmountConversionsTest {
    uint256 private constant SCALE8_PER_UNIT6 = 100;
    uint256 private constant NATIVE_PER_UNIT6 = 1_000_000_000_000;

    function testExactScale8ToUnits6Vectors() public pure {
        assert(AmountConversions.scale8ToUnits6(100) == 1);
        assert(AmountConversions.scale8ToUnits6(123_456_700) == 1_234_567);
        assert(AmountConversions.scale8ToUnits6(100_000_000) == 1_000_000);
    }

    function testExactUnits6ToScale8AndNative18Vectors() public pure {
        assert(AmountConversions.units6ToScale8(1) == 100);
        assert(AmountConversions.units6ToScale8(1_234_567) == 123_456_700);
        assert(AmountConversions.units6ToNative18(1) == NATIVE_PER_UNIT6);
        assert(AmountConversions.units6ToNative18(1_234_567) == 1_234_567_000_000_000_000);
        assert(AmountConversions.native18ToUnits6(NATIVE_PER_UNIT6) == 1);
        assert(AmountConversions.native18ToUnits6(1_234_567_000_000_000_000) == 1_234_567);
    }

    function testRejectsZeroAndTruncatingConversions() public {
        _expectRevert(abi.encodeCall(this.callScale8ToUnits6, (0)));
        _expectRevert(abi.encodeCall(this.callScale8ToUnits6, (1)));
        _expectRevert(abi.encodeCall(this.callScale8ToUnits6, (101)));

        _expectRevert(abi.encodeCall(this.callUnits6ToScale8, (0)));
        _expectRevert(abi.encodeCall(this.callUnits6ToNative18, (0)));

        _expectRevert(abi.encodeCall(this.callNative18ToUnits6, (0)));
        _expectRevert(abi.encodeCall(this.callNative18ToUnits6, (1)));
        _expectRevert(abi.encodeCall(this.callNative18ToUnits6, (NATIVE_PER_UNIT6 + 1)));
    }

    function testRejectsOverflowBeforeMultiplication() public {
        _expectRevert(abi.encodeCall(this.callUnits6ToScale8, (type(uint256).max / SCALE8_PER_UNIT6 + 1)));
        _expectRevert(abi.encodeCall(this.callUnits6ToNative18, (type(uint256).max / NATIVE_PER_UNIT6 + 1)));
    }

    function testRequiresExplicitNative18ToUnits6Comparison() public pure {
        assert(AmountConversions.native18AmountEqualsUnits6(1, NATIVE_PER_UNIT6));
        assert(AmountConversions.native18AmountEqualsUnits6(1_000_000, 1_000_000_000_000_000_000));
        assert(!AmountConversions.native18AmountEqualsUnits6(1_000_000, 1_000_000));
    }

    function callScale8ToUnits6(uint256 amountScale8) external pure returns (uint256) {
        return AmountConversions.scale8ToUnits6(amountScale8);
    }

    function callUnits6ToScale8(uint256 amountUnits6) external pure returns (uint256) {
        return AmountConversions.units6ToScale8(amountUnits6);
    }

    function callUnits6ToNative18(uint256 amountUnits6) external pure returns (uint256) {
        return AmountConversions.units6ToNative18(amountUnits6);
    }

    function callNative18ToUnits6(uint256 amountNative18) external pure returns (uint256) {
        return AmountConversions.native18ToUnits6(amountNative18);
    }

    function _expectRevert(bytes memory callData) private {
        (bool success,) = address(this).call(callData);
        assert(!success);
    }
}
