// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CanonicalResearch} from "../../../src/canonical/CanonicalResearch.sol";

contract CanonicalVectorsTest {
    uint256 private constant CHAIN_ID = 5_042_002;
    address private constant BUYER = 0x1111111111111111111111111111111111111111;
    address private constant PAYOUT = 0x2222222222222222222222222222222222222222;

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant REQUEST_KEY = 0xbb469196cc6b5028360740da10f0e57e763db8971c37fe1a04515283233e32ab;
    bytes32 private constant SETTLEMENT_KEY = 0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7;
    bytes32 private constant SOURCE_ID = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1;
    bytes32 private constant ITEMS_HASH = 0x97180eb3603765a7d6b345f882b2e54df6caa90acf6f2a372b7b2197fbd707ea;
    bytes32 private constant SETTLEMENT_RESULT_DIGEST =
        0xb1518f344eeee729e760f0c0d2be569b83fa550833b2309d8e6b7e2cb037b6c4;
    bytes32 private constant EMPTY_FINAL_LIABILITY_HASH =
        0xa700e53730858c2f4b9b5e2287eb6277837358afa904bd8288dccd07809876e4;
    bytes32 private constant SINGLE_PAID_FINAL_LIABILITY_HASH =
        0x338ee25354eba1e0ea3d435dce293825bc9f8143a25d97c1ecfeb5eb29ad3f2e;

    function testCanonicalKeyAndDigestVectorsMatchDesign() public pure {
        assert(CanonicalResearch.researchKey(CHAIN_ID, BUYER, "00000000-0000-4000-8000-000000000001") == RESEARCH_KEY);
        assert(CanonicalResearch.requestKey(RESEARCH_KEY, "00000000-0000-4000-8000-000000000002") == REQUEST_KEY);
        assert(CanonicalResearch.settlementKey(RESEARCH_KEY, "00000000-0000-4000-8000-000000000003") == SETTLEMENT_KEY);
        assert(CanonicalResearch.sourceId("whale-flow") == SOURCE_ID);

        CanonicalResearch.SettlementItem[] memory items = new CanonicalResearch.SettlementItem[](1);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: REQUEST_KEY,
            sourceId: SOURCE_ID,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: 1_000,
            amount: 100
        });

        assert(CanonicalResearch.itemsHash(items) == ITEMS_HASH);
        assert(CanonicalResearch.settlementResultDigest(SETTLEMENT_KEY, ITEMS_HASH, 100, 1) == SETTLEMENT_RESULT_DIGEST);

        CanonicalResearch.LiabilityItem[] memory emptyLiabilities = new CanonicalResearch.LiabilityItem[](0);
        assert(CanonicalResearch.finalLiabilityHash(emptyLiabilities) == EMPTY_FINAL_LIABILITY_HASH);

        CanonicalResearch.LiabilityItem[] memory singlePaid = new CanonicalResearch.LiabilityItem[](1);
        singlePaid[0] = CanonicalResearch.LiabilityItem({
            requestKey: REQUEST_KEY,
            amount: 100,
            terminalState: 1,
            settlementKey: SETTLEMENT_KEY,
            terminalEvidenceHash: SETTLEMENT_RESULT_DIGEST
        });
        assert(CanonicalResearch.finalLiabilityHash(singlePaid) == SINGLE_PAID_FINAL_LIABILITY_HASH);
        assert(CanonicalResearch.finalLiabilityHashWithSpent(singlePaid, 100) == SINGLE_PAID_FINAL_LIABILITY_HASH);
    }

    function testRejectsNonCanonicalIdsAndSourceNames() public {
        _expectRevert(abi.encodeCall(this.callResearchKey, ("00000000-0000-4000-8000-00000000000A")));
        _expectRevert(abi.encodeCall(this.callResearchKey, ("00000000000040008000000000000001")));
        _expectRevert(abi.encodeCall(this.callSourceId, ("Whale-Flow")));
        _expectRevert(abi.encodeCall(this.callSourceId, ("")));
    }

    function testRejectsZeroUnsortedAndDuplicateSettlementItems() public {
        _expectRevert(abi.encodeCall(this.callItemsHash, (new CanonicalResearch.SettlementItem[](0))));

        CanonicalResearch.SettlementItem[] memory items = _twoItems(bytes32(uint256(1)), bytes32(uint256(2)));

        items[0].requestKey = bytes32(0);
        _expectRevert(abi.encodeCall(this.callItemsHash, (items)));

        items = _twoItems(bytes32(uint256(1)), bytes32(uint256(2)));
        items[0].sourceId = bytes32(0);
        _expectRevert(abi.encodeCall(this.callItemsHash, (items)));

        items = _twoItems(bytes32(uint256(2)), bytes32(uint256(1)));
        _expectRevert(abi.encodeCall(this.callItemsHash, (items)));

        items = _twoItems(bytes32(uint256(1)), bytes32(uint256(1)));
        _expectRevert(abi.encodeCall(this.callItemsHash, (items)));
    }

    function testRejectsInvalidLiabilityStateEvidenceSpentAndOmissions() public {
        CanonicalResearch.LiabilityItem[] memory liabilities = _singlePaidLiability();

        _expectRevert(abi.encodeCall(this.callFinalLiabilityHashWithSpent, (liabilities, 101)));

        liabilities[0].terminalState = 99;
        _expectRevert(abi.encodeCall(this.callFinalLiabilityHashWithSpent, (liabilities, 100)));

        liabilities = _singlePaidLiability();
        liabilities[0].settlementKey = bytes32(0);
        _expectRevert(abi.encodeCall(this.callFinalLiabilityHashWithSpent, (liabilities, 100)));

        liabilities = _singlePaidLiability();
        liabilities[0].terminalState = 2;
        _expectRevert(abi.encodeCall(this.callFinalLiabilityHashWithSpent, (liabilities, 0)));

        liabilities = _singlePaidLiability();
        bytes32[] memory expectedKeys = new bytes32[](1);
        expectedKeys[0] = bytes32(uint256(123));
        _expectRevert(abi.encodeCall(this.callFinalLiabilityHashForRequests, (liabilities, expectedKeys, 100)));
    }

    function callResearchKey(string memory canonicalResearchId) external pure returns (bytes32) {
        return CanonicalResearch.researchKey(CHAIN_ID, BUYER, canonicalResearchId);
    }

    function callSourceId(string memory canonicalSourceName) external pure returns (bytes32) {
        return CanonicalResearch.sourceId(canonicalSourceName);
    }

    function callItemsHash(CanonicalResearch.SettlementItem[] memory items) external pure returns (bytes32) {
        return CanonicalResearch.itemsHash(items);
    }

    function callFinalLiabilityHashWithSpent(CanonicalResearch.LiabilityItem[] memory liabilities, uint256 spent)
        external
        pure
        returns (bytes32)
    {
        return CanonicalResearch.finalLiabilityHashWithSpent(liabilities, spent);
    }

    function callFinalLiabilityHashForRequests(
        CanonicalResearch.LiabilityItem[] memory liabilities,
        bytes32[] memory expectedRequestKeys,
        uint256 spent
    ) external pure returns (bytes32) {
        return CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, spent);
    }

    function _twoItems(bytes32 firstRequestKey, bytes32 secondRequestKey)
        private
        pure
        returns (CanonicalResearch.SettlementItem[] memory items)
    {
        items = new CanonicalResearch.SettlementItem[](2);
        items[0] = CanonicalResearch.SettlementItem({
            requestKey: firstRequestKey,
            sourceId: SOURCE_ID,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: 1_000,
            amount: 100
        });
        items[1] = CanonicalResearch.SettlementItem({
            requestKey: secondRequestKey,
            sourceId: SOURCE_ID,
            registryRevision: 1,
            expectedPayout: PAYOUT,
            maxUnitPrice: 1_000,
            amount: 100
        });
    }

    function _singlePaidLiability() private pure returns (CanonicalResearch.LiabilityItem[] memory liabilities) {
        liabilities = new CanonicalResearch.LiabilityItem[](1);
        liabilities[0] = CanonicalResearch.LiabilityItem({
            requestKey: REQUEST_KEY,
            amount: 100,
            terminalState: 1,
            settlementKey: SETTLEMENT_KEY,
            terminalEvidenceHash: SETTLEMENT_RESULT_DIGEST
        });
    }

    function _expectRevert(bytes memory callData) private {
        (bool success,) = address(this).call(callData);
        assert(!success);
    }
}
