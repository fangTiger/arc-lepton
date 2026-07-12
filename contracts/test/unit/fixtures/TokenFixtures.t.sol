// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FalseReturnToken} from "../../fixtures/tokens/FalseReturnToken.sol";
import {FeeOnTransferToken} from "../../fixtures/tokens/FeeOnTransferToken.sol";
import {MockUSDC} from "../../fixtures/tokens/MockUSDC.sol";
import {RevertingToken, RevertingTokenTransferBlocked} from "../../fixtures/tokens/RevertingToken.sol";
import {ReentrantToken} from "../../fixtures/tokens/ReentrantToken.sol";

contract TokenActor {
    function approve(IERC20 token, address spender, uint256 value) external returns (bool) {
        return token.approve(spender, value);
    }
}

contract TokenFixturesTest {
    error CallbackRejected(uint256 code);

    address private constant RECEIVER = address(0xBEEF);
    address private constant NESTED_RECEIVER = address(0xCAFE);
    uint256 private constant ONE_USDC = 1_000_000;
    uint256 private constant CALLBACK_ERROR_CODE = 0xC0FFEE;

    uint256 private callbackCount;
    ReentrantToken private callbackToken;

    function testMockUSDCUsesSixDecimalsAndMintsExactAmount() public {
        MockUSDC token = new MockUSDC();
        uint256 amount = 25 * ONE_USDC;

        token.mint(address(this), amount);

        assert(token.decimals() == 6);
        assert(token.balanceOf(address(this)) == amount);
        assert(token.totalSupply() == amount);
    }

    function testAdversarialTokensAllUseSixDecimals() public {
        assert(new FalseReturnToken().decimals() == 6);
        assert(new RevertingToken().decimals() == 6);
        assert(new FeeOnTransferToken().decimals() == 6);
        assert(new ReentrantToken().decimals() == 6);
    }

    function testFalseReturnTokenTransferReturnsFalseWithoutMovingBalance() public {
        FalseReturnToken token = new FalseReturnToken();
        TokenActor delegatedSpender = new TokenActor();
        uint256 initialBalance = 10 * ONE_USDC;
        uint256 requestedAmount = 4 * ONE_USDC;
        uint256 allowanceAmount = 3 * ONE_USDC;
        token.mint(address(this), initialBalance);
        assert(token.approve(address(delegatedSpender), allowanceAmount));

        uint256 senderBalanceBefore = token.balanceOf(address(this));
        uint256 receiverBalanceBefore = token.balanceOf(RECEIVER);
        uint256 allowanceBefore = token.allowance(address(this), address(delegatedSpender));
        uint256 totalSupplyBefore = token.totalSupply();

        bool transferred = token.transfer(RECEIVER, requestedAmount);

        assert(!transferred);
        assert(token.balanceOf(address(this)) == senderBalanceBefore);
        assert(token.balanceOf(RECEIVER) == receiverBalanceBefore);
        assert(token.allowance(address(this), address(delegatedSpender)) == allowanceBefore);
        assert(token.totalSupply() == totalSupplyBefore);
    }

    function testFalseReturnTokenTransferFromReturnsFalseWithoutSpendingAllowance() public {
        FalseReturnToken token = new FalseReturnToken();
        TokenActor owner = new TokenActor();
        uint256 initialBalance = 10 * ONE_USDC;
        uint256 allowanceAmount = 4 * ONE_USDC;
        token.mint(address(owner), initialBalance);
        assert(owner.approve(token, address(this), allowanceAmount));

        uint256 senderBalanceBefore = token.balanceOf(address(owner));
        uint256 receiverBalanceBefore = token.balanceOf(RECEIVER);
        uint256 allowanceBefore = token.allowance(address(owner), address(this));
        uint256 totalSupplyBefore = token.totalSupply();

        bool transferred = token.transferFrom(address(owner), RECEIVER, allowanceAmount);

        assert(!transferred);
        assert(token.balanceOf(address(owner)) == senderBalanceBefore);
        assert(token.balanceOf(RECEIVER) == receiverBalanceBefore);
        assert(token.allowance(address(owner), address(this)) == allowanceBefore);
        assert(token.totalSupply() == totalSupplyBefore);
    }

    function testRevertingTokenTransferUsesCustomErrorWithoutMovingBalance() public {
        RevertingToken token = new RevertingToken();
        TokenActor delegatedSpender = new TokenActor();
        uint256 initialBalance = 10 * ONE_USDC;
        uint256 requestedAmount = 4 * ONE_USDC;
        uint256 allowanceAmount = 3 * ONE_USDC;
        token.mint(address(this), initialBalance);
        assert(token.approve(address(delegatedSpender), allowanceAmount));

        uint256 senderBalanceBefore = token.balanceOf(address(this));
        uint256 receiverBalanceBefore = token.balanceOf(RECEIVER);
        uint256 allowanceBefore = token.allowance(address(this), address(delegatedSpender));
        uint256 totalSupplyBefore = token.totalSupply();
        bytes memory expectedRevertData = abi.encodeWithSelector(RevertingTokenTransferBlocked.selector);

        (bool success, bytes memory revertData) =
            address(token).call(abi.encodeCall(token.transfer, (RECEIVER, requestedAmount)));

        assert(!success);
        _assertBytesEqual(revertData, expectedRevertData);
        assert(token.balanceOf(address(this)) == senderBalanceBefore);
        assert(token.balanceOf(RECEIVER) == receiverBalanceBefore);
        assert(token.allowance(address(this), address(delegatedSpender)) == allowanceBefore);
        assert(token.totalSupply() == totalSupplyBefore);
    }

    function testRevertingTokenTransferFromUsesCustomErrorWithoutSpendingAllowance() public {
        RevertingToken token = new RevertingToken();
        TokenActor owner = new TokenActor();
        uint256 initialBalance = 10 * ONE_USDC;
        uint256 allowanceAmount = 4 * ONE_USDC;
        token.mint(address(owner), initialBalance);
        assert(owner.approve(token, address(this), allowanceAmount));

        uint256 senderBalanceBefore = token.balanceOf(address(owner));
        uint256 receiverBalanceBefore = token.balanceOf(RECEIVER);
        uint256 allowanceBefore = token.allowance(address(owner), address(this));
        uint256 totalSupplyBefore = token.totalSupply();
        bytes memory expectedRevertData = abi.encodeWithSelector(RevertingTokenTransferBlocked.selector);

        (bool success, bytes memory revertData) =
            address(token).call(abi.encodeCall(token.transferFrom, (address(owner), RECEIVER, allowanceAmount)));

        assert(!success);
        _assertBytesEqual(revertData, expectedRevertData);
        assert(token.balanceOf(address(owner)) == senderBalanceBefore);
        assert(token.balanceOf(RECEIVER) == receiverBalanceBefore);
        assert(token.allowance(address(owner), address(this)) == allowanceBefore);
        assert(token.totalSupply() == totalSupplyBefore);
    }

    function testFeeOnTransferBurnsFixedFeeAndReceiverGetsNetAmount() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        uint256 initialBalance = 200 * ONE_USDC;
        uint256 requestedAmount = 100 * ONE_USDC;
        uint256 expectedFee = requestedAmount * token.FEE_BPS() / token.BPS_DENOMINATOR();
        token.mint(address(this), initialBalance);

        bool transferred = token.transfer(RECEIVER, requestedAmount);

        assert(transferred);
        assert(token.balanceOf(address(this)) == initialBalance - requestedAmount);
        assert(token.balanceOf(RECEIVER) == requestedAmount - expectedFee);
        assert(token.totalSupply() == initialBalance - expectedFee);
    }

    function testFeeOnTransferTransferFromChargesFeeAndSpendsRequestedAllowance() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        TokenActor owner = new TokenActor();
        uint256 initialBalance = 200 * ONE_USDC;
        uint256 requestedAmount = 100 * ONE_USDC;
        uint256 expectedFee = requestedAmount * token.FEE_BPS() / token.BPS_DENOMINATOR();
        token.mint(address(owner), initialBalance);
        owner.approve(token, address(this), requestedAmount);

        bool transferred = token.transferFrom(address(owner), RECEIVER, requestedAmount);

        assert(transferred);
        assert(token.balanceOf(address(owner)) == initialBalance - requestedAmount);
        assert(token.balanceOf(RECEIVER) == requestedAmount - expectedFee);
        assert(token.totalSupply() == initialBalance - expectedFee);
        assert(token.allowance(address(owner), address(this)) == 0);
    }

    function testFeeOnTransferMintAndBurnDoNotChargeFee() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        uint256 mintedAmount = 200 * ONE_USDC;
        uint256 burnedAmount = 20 * ONE_USDC;

        token.mint(address(this), mintedAmount);
        token.burn(burnedAmount);

        assert(token.balanceOf(address(this)) == mintedAmount - burnedAmount);
        assert(token.totalSupply() == mintedAmount - burnedAmount);
    }

    function testFeeOnTransferRoundsEveryNonzeroSmallAmountUpToOneUnit() public {
        uint256[3] memory requestedAmounts = [uint256(1), uint256(99), uint256(100)];

        for (uint256 index = 0; index < requestedAmounts.length; ++index) {
            FeeOnTransferToken token = new FeeOnTransferToken();
            uint256 requestedAmount = requestedAmounts[index];
            token.mint(address(this), requestedAmount);

            bool transferred = token.transfer(RECEIVER, requestedAmount);

            assert(transferred);
            assert(token.balanceOf(address(this)) == 0);
            assert(token.balanceOf(RECEIVER) == requestedAmount - 1);
            assert(token.totalSupply() == requestedAmount - 1);
        }
    }

    function testFeeOnTransferZeroValueDoesNotChargeFee() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        uint256 initialBalance = 7;
        token.mint(address(this), initialBalance);

        bool transferred = token.transfer(RECEIVER, 0);

        assert(transferred);
        assert(token.balanceOf(address(this)) == initialBalance);
        assert(token.balanceOf(RECEIVER) == 0);
        assert(token.totalSupply() == initialBalance);
    }

    function testFeeOnTransferSelfTransferRejectsBalanceBelowFullRequestedValueAtomically() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        uint256 initialBalance = 99;
        uint256 requestedAmount = 100;
        token.mint(address(this), initialBalance);
        bytes memory expectedRevertData = abi.encodeWithSignature(
            "ERC20InsufficientBalance(address,uint256,uint256)", address(this), initialBalance - 1, requestedAmount - 1
        );

        (bool success, bytes memory revertData) =
            address(token).call(abi.encodeCall(token.transfer, (address(this), requestedAmount)));

        assert(!success);
        _assertBytesEqual(revertData, expectedRevertData);
        assert(token.balanceOf(address(this)) == initialBalance);
        assert(token.totalSupply() == initialBalance);
    }

    function testFeeOnTransferSelfTransferWithFullBalanceOnlyBurnsFee() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        uint256 initialBalance = 100;
        uint256 requestedAmount = 100;
        uint256 expectedFee = 1;
        token.mint(address(this), initialBalance);

        bool transferred = token.transfer(address(this), requestedAmount);

        assert(transferred);
        assert(token.balanceOf(address(this)) == initialBalance - expectedFee);
        assert(token.totalSupply() == initialBalance - expectedFee);
    }

    function testReentrantTokenTransferAllowsOneNestedCallbackWithoutRecursingAgain() public {
        ReentrantToken token = new ReentrantToken();
        uint256 initialBalance = 100 * ONE_USDC;
        uint256 outerAmount = 20 * ONE_USDC;
        callbackCount = 0;
        callbackToken = token;
        token.mint(address(this), initialBalance);
        token.configureCallback(address(this), abi.encodeCall(this.reenterTokenOnce, ()));

        bool transferred = token.transfer(RECEIVER, outerAmount);

        assert(transferred);
        assert(callbackCount == 1);
        assert(token.balanceOf(address(this)) == initialBalance - outerAmount - ONE_USDC);
        assert(token.balanceOf(RECEIVER) == outerAmount);
        assert(token.balanceOf(NESTED_RECEIVER) == ONE_USDC);
    }

    function testReentrantTokenTransferFromExecutesConfiguredCallbackOnce() public {
        ReentrantToken token = new ReentrantToken();
        TokenActor owner = new TokenActor();
        uint256 requestedAmount = 20 * ONE_USDC;
        callbackCount = 0;
        callbackToken = token;
        token.mint(address(owner), 100 * ONE_USDC);
        owner.approve(token, address(this), requestedAmount);
        token.configureCallback(address(this), abi.encodeCall(this.recordCallback, ()));

        bool transferred = token.transferFrom(address(owner), RECEIVER, requestedAmount);

        assert(transferred);
        assert(callbackCount == 1);
        assert(token.balanceOf(address(owner)) == 80 * ONE_USDC);
        assert(token.balanceOf(RECEIVER) == requestedAmount);
        assert(token.allowance(address(owner), address(this)) == 0);
    }

    function testReentrantTokenConsecutiveTransferAndTransferFromEachInvokeCallbackOnce() public {
        ReentrantToken token = new ReentrantToken();
        uint256 initialBalance = 100 * ONE_USDC;
        uint256 requestedAmount = 10 * ONE_USDC;
        callbackCount = 0;
        callbackToken = token;
        token.mint(address(this), initialBalance);
        token.configureCallback(address(this), abi.encodeCall(this.recordCallback, ()));

        bool firstTransferred = token.transfer(RECEIVER, requestedAmount);
        assert(token.approve(address(this), requestedAmount));
        bool secondTransferred = token.transferFrom(address(this), NESTED_RECEIVER, requestedAmount);

        assert(firstTransferred);
        assert(secondTransferred);
        assert(callbackCount == 2);
        assert(token.balanceOf(address(this)) == initialBalance - (2 * requestedAmount));
        assert(token.balanceOf(RECEIVER) == requestedAmount);
        assert(token.balanceOf(NESTED_RECEIVER) == requestedAmount);
        assert(token.allowance(address(this), address(this)) == 0);
    }

    function testReentrantTokenTransferBubblesFullFailureAndDoesNotStickCallbackLock() public {
        ReentrantToken token = new ReentrantToken();
        uint256 initialBalance = 100 * ONE_USDC;
        uint256 requestedAmount = 20 * ONE_USDC;
        callbackCount = 0;
        callbackToken = token;
        token.mint(address(this), initialBalance);
        token.configureCallback(address(this), abi.encodeCall(this.rejectCallback, ()));
        bytes memory expectedRevertData = abi.encodeWithSelector(CallbackRejected.selector, CALLBACK_ERROR_CODE);

        (bool success, bytes memory revertData) =
            address(token).call(abi.encodeCall(token.transfer, (RECEIVER, requestedAmount)));

        assert(!success);
        _assertBytesEqual(revertData, expectedRevertData);
        assert(token.balanceOf(address(this)) == initialBalance);
        assert(token.balanceOf(RECEIVER) == 0);
        assert(token.totalSupply() == initialBalance);

        token.configureCallback(address(this), abi.encodeCall(this.recordCallback, ()));
        bool retried = token.transfer(RECEIVER, requestedAmount);

        assert(retried);
        assert(callbackCount == 1);
        assert(token.balanceOf(address(this)) == initialBalance - requestedAmount);
        assert(token.balanceOf(RECEIVER) == requestedAmount);
        assert(token.totalSupply() == initialBalance);
    }

    function testReentrantTokenTransferFromBubblesFailureAndRestoresAllowance() public {
        ReentrantToken token = new ReentrantToken();
        TokenActor owner = new TokenActor();
        uint256 initialBalance = 100 * ONE_USDC;
        uint256 requestedAmount = 20 * ONE_USDC;
        token.mint(address(owner), initialBalance);
        owner.approve(token, address(this), requestedAmount);
        token.configureCallback(address(this), abi.encodeCall(this.rejectCallback, ()));
        bytes memory expectedRevertData = abi.encodeWithSelector(CallbackRejected.selector, CALLBACK_ERROR_CODE);

        (bool success, bytes memory revertData) =
            address(token).call(abi.encodeCall(token.transferFrom, (address(owner), RECEIVER, requestedAmount)));

        assert(!success);
        _assertBytesEqual(revertData, expectedRevertData);
        assert(token.balanceOf(address(owner)) == initialBalance);
        assert(token.balanceOf(RECEIVER) == 0);
        assert(token.allowance(address(owner), address(this)) == requestedAmount);
        assert(token.totalSupply() == initialBalance);
    }

    function reenterTokenOnce() external {
        assert(msg.sender == address(callbackToken));
        callbackCount += 1;
        bool transferred = callbackToken.transfer(NESTED_RECEIVER, ONE_USDC);
        assert(transferred);
    }

    function recordCallback() external {
        assert(msg.sender == address(callbackToken));
        callbackCount += 1;
    }

    function rejectCallback() external pure {
        revert CallbackRejected(CALLBACK_ERROR_CODE);
    }

    function _assertBytesEqual(bytes memory actual, bytes memory expected) private pure {
        assert(actual.length == expected.length);
        assert(keccak256(actual) == keccak256(expected));
    }
}
