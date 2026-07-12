// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library CanonicalResearch {
    error NonCanonicalId();
    error NonCanonicalSource();
    error ZeroKey();
    error EmptyItems();
    error UnsortedKeys();
    error InvalidTerminalState();
    error InvalidLiabilityEvidence();
    error SpentMismatch(uint256 paidTotal, uint256 spent);
    error MissingLiability();

    uint8 internal constant TERMINAL_STATE_PAID = 1;
    uint8 internal constant TERMINAL_STATE_VOID_BEFORE_SIDE_EFFECT = 2;
    uint8 internal constant TERMINAL_STATE_UNPAYABLE_MANUAL = 3;

    bytes32 internal constant RESEARCH_DOMAIN = keccak256(bytes("arc-lepton.research-key.v1"));
    bytes32 internal constant REQUEST_DOMAIN = keccak256(bytes("arc-lepton.request-key.v1"));
    bytes32 internal constant SETTLEMENT_DOMAIN = keccak256(bytes("arc-lepton.settlement-key.v1"));
    bytes32 internal constant SOURCE_DOMAIN = keccak256(bytes("arc-lepton.source-id.v1"));
    bytes32 internal constant ITEMS_DOMAIN = keccak256(bytes("arc-lepton.items-hash.v1"));
    bytes32 internal constant SETTLEMENT_RESULT_DOMAIN = keccak256(bytes("arc-lepton.settlement-result.v1"));
    bytes32 internal constant FINAL_LIABILITY_DOMAIN = keccak256(bytes("arc-lepton.final-liability.v1"));

    struct SettlementItem {
        bytes32 requestKey;
        bytes32 sourceId;
        uint64 registryRevision;
        address expectedPayout;
        uint256 maxUnitPrice;
        uint256 amount;
    }

    struct LiabilityItem {
        bytes32 requestKey;
        uint256 amount;
        uint8 terminalState;
        bytes32 settlementKey;
        bytes32 terminalEvidenceHash;
    }

    function researchKey(uint256 chainId, address buyer, string memory canonicalResearchId)
        internal
        pure
        returns (bytes32)
    {
        _requireCanonicalUuid(canonicalResearchId);

        return keccak256(abi.encode(RESEARCH_DOMAIN, chainId, buyer, keccak256(bytes(canonicalResearchId))));
    }

    function requestKey(bytes32 researchKeyValue, string memory canonicalPaymentIntentId)
        internal
        pure
        returns (bytes32)
    {
        _requireNonZero(researchKeyValue);
        _requireCanonicalUuid(canonicalPaymentIntentId);

        return keccak256(abi.encode(REQUEST_DOMAIN, researchKeyValue, keccak256(bytes(canonicalPaymentIntentId))));
    }

    function settlementKey(bytes32 researchKeyValue, string memory canonicalSettlementId)
        internal
        pure
        returns (bytes32)
    {
        _requireNonZero(researchKeyValue);
        _requireCanonicalUuid(canonicalSettlementId);

        return keccak256(abi.encode(SETTLEMENT_DOMAIN, researchKeyValue, keccak256(bytes(canonicalSettlementId))));
    }

    function sourceId(string memory canonicalSourceName) internal pure returns (bytes32) {
        _requireCanonicalSource(canonicalSourceName);

        return keccak256(abi.encode(SOURCE_DOMAIN, keccak256(bytes(canonicalSourceName))));
    }

    function itemsHash(SettlementItem[] memory items) internal pure returns (bytes32) {
        _validateItems(items);

        return keccak256(abi.encode(ITEMS_DOMAIN, uint256(1), items));
    }

    function settlementResultDigest(bytes32 settlementKeyValue, bytes32 itemsHashValue, uint256 total, uint32 itemCount)
        internal
        pure
        returns (bytes32)
    {
        _requireNonZero(settlementKeyValue);
        _requireNonZero(itemsHashValue);

        return keccak256(abi.encode(SETTLEMENT_RESULT_DOMAIN, settlementKeyValue, itemsHashValue, total, itemCount));
    }

    function finalLiabilityHash(LiabilityItem[] memory liabilities) internal pure returns (bytes32) {
        _validateLiabilities(liabilities);

        return keccak256(abi.encode(FINAL_LIABILITY_DOMAIN, uint256(1), liabilities));
    }

    function finalLiabilityHashWithSpent(LiabilityItem[] memory liabilities, uint256 spent)
        internal
        pure
        returns (bytes32)
    {
        uint256 paidTotal = _validateLiabilities(liabilities);
        if (paidTotal != spent) {
            revert SpentMismatch(paidTotal, spent);
        }

        return keccak256(abi.encode(FINAL_LIABILITY_DOMAIN, uint256(1), liabilities));
    }

    function finalLiabilityHashForRequests(
        LiabilityItem[] memory liabilities,
        bytes32[] memory expectedRequestKeys,
        uint256 spent
    ) internal pure returns (bytes32) {
        if (liabilities.length != expectedRequestKeys.length) {
            revert MissingLiability();
        }
        _validateExpectedRequestKeys(expectedRequestKeys);
        uint256 paidTotal = _validateLiabilities(liabilities);

        for (uint256 index = 0; index < liabilities.length; ++index) {
            if (liabilities[index].requestKey != expectedRequestKeys[index]) {
                revert MissingLiability();
            }
        }

        if (paidTotal != spent) {
            revert SpentMismatch(paidTotal, spent);
        }

        return keccak256(abi.encode(FINAL_LIABILITY_DOMAIN, uint256(1), liabilities));
    }

    function _validateItems(SettlementItem[] memory items) private pure {
        if (items.length == 0) {
            revert EmptyItems();
        }

        bytes32 previousRequestKey = bytes32(0);
        for (uint256 index = 0; index < items.length; ++index) {
            SettlementItem memory item = items[index];
            _requireNonZero(item.requestKey);
            _requireNonZero(item.sourceId);
            if (index > 0 && uint256(item.requestKey) <= uint256(previousRequestKey)) {
                revert UnsortedKeys();
            }
            previousRequestKey = item.requestKey;
        }
    }

    function _validateLiabilities(LiabilityItem[] memory liabilities) private pure returns (uint256 paidTotal) {
        bytes32 previousRequestKey = bytes32(0);
        for (uint256 index = 0; index < liabilities.length; ++index) {
            LiabilityItem memory liability = liabilities[index];
            _requireNonZero(liability.requestKey);
            if (index > 0 && uint256(liability.requestKey) <= uint256(previousRequestKey)) {
                revert UnsortedKeys();
            }
            previousRequestKey = liability.requestKey;

            if (liability.terminalState == TERMINAL_STATE_PAID) {
                if (liability.settlementKey == bytes32(0) || liability.terminalEvidenceHash == bytes32(0)) {
                    revert InvalidLiabilityEvidence();
                }
                paidTotal += liability.amount;
            } else if (
                liability.terminalState == TERMINAL_STATE_VOID_BEFORE_SIDE_EFFECT
                    || liability.terminalState == TERMINAL_STATE_UNPAYABLE_MANUAL
            ) {
                if (liability.settlementKey != bytes32(0) || liability.terminalEvidenceHash == bytes32(0)) {
                    revert InvalidLiabilityEvidence();
                }
            } else {
                revert InvalidTerminalState();
            }
        }
    }

    function _validateExpectedRequestKeys(bytes32[] memory expectedRequestKeys) private pure {
        bytes32 previousRequestKey = bytes32(0);
        for (uint256 index = 0; index < expectedRequestKeys.length; ++index) {
            bytes32 requestKeyValue = expectedRequestKeys[index];
            _requireNonZero(requestKeyValue);
            if (index > 0 && uint256(requestKeyValue) <= uint256(previousRequestKey)) {
                revert UnsortedKeys();
            }
            previousRequestKey = requestKeyValue;
        }
    }

    function _requireNonZero(bytes32 key) private pure {
        if (key == bytes32(0)) {
            revert ZeroKey();
        }
    }

    function _requireCanonicalUuid(string memory value) private pure {
        bytes memory raw = bytes(value);
        if (raw.length != 36) {
            revert NonCanonicalId();
        }

        for (uint256 index = 0; index < raw.length; ++index) {
            uint8 character = uint8(raw[index]);
            bool hyphenPosition = index == 8 || index == 13 || index == 18 || index == 23;
            if (hyphenPosition) {
                if (character != 0x2d) {
                    revert NonCanonicalId();
                }
            } else if (!((character >= 0x30 && character <= 0x39) || (character >= 0x61 && character <= 0x66))) {
                revert NonCanonicalId();
            }
        }
    }

    function _requireCanonicalSource(string memory value) private pure {
        bytes memory raw = bytes(value);
        if (raw.length == 0) {
            revert NonCanonicalSource();
        }

        for (uint256 index = 0; index < raw.length; ++index) {
            uint8 character = uint8(raw[index]);
            bool valid = (character >= 0x30 && character <= 0x39) || (character >= 0x61 && character <= 0x7a)
                || character == 0x2d;
            if (!valid) {
                revert NonCanonicalSource();
            }
        }
    }
}
