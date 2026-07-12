// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";

contract Eip712SignatureValidationTest {
    uint256 private constant CHAIN_ID = 5_042_002;
    address private constant FACTORY = 0x3333333333333333333333333333333333333333;
    address private constant SIGNER = 0x8fd379246834eac74B8419FfdA202CF8051F7A03;
    address private constant BUYER = 0x1111111111111111111111111111111111111111;
    address private constant INTENT_SIGNER = 0x5555555555555555555555555555555555555555;
    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes private constant VALID_SIGNATURE =
        hex"714338239e5e80df7031956bb878a5f571c41189a090a46e3bf94080533245c00e492bdabcf91b08563a2508b01bb73d7a9e8d9b38b216f3ae701a30468d2f631c";
    bytes private constant MALLEABLE_SIGNATURE =
        hex"714338239e5e80df7031956bb878a5f571c41189a090a46e3bf94080533245c0f1b6d4254306e4f7a9c5daf74fe448c140104f4b769689481162445c89a911de1b";

    function testFlexibleSignatureAcceptsCanonicalEoaAndErc1271() public {
        bytes32 digest = _fundingDigest(7);
        MockERC1271Wallet wallet = new MockERC1271Wallet(digest, VALID_SIGNATURE);

        assert(ResearchEscrowEip712.isValidFlexibleSignature(SIGNER, digest, VALID_SIGNATURE));
        assert(ResearchEscrowEip712.isValidFlexibleSignature(address(wallet), digest, VALID_SIGNATURE));
    }

    function testStrictIntentSignatureAcceptsOnlyCanonicalEoaSignature() public {
        bytes32 digest = _fundingDigest(7);
        MockERC1271Wallet wallet = new MockERC1271Wallet(digest, VALID_SIGNATURE);

        assert(ResearchEscrowEip712.isValidStrictEoaSignature(SIGNER, digest, VALID_SIGNATURE));
        assert(!ResearchEscrowEip712.isValidStrictEoaSignature(address(wallet), digest, VALID_SIGNATURE));
        assert(!ResearchEscrowEip712.isValidStrictEoaSignature(SIGNER, digest, MALLEABLE_SIGNATURE));
    }

    function testSignatureRejectsWrongDomainAndNonceTampering() public view {
        bytes32 digest = _fundingDigest(7);
        bytes32 wrongDomainDigest = ResearchEscrowEip712.fundingVoucherDigest(CHAIN_ID + 1, FACTORY, _voucher(7));
        bytes32 wrongNonceDigest = _fundingDigest(8);

        assert(ResearchEscrowEip712.isValidFlexibleSignature(SIGNER, digest, VALID_SIGNATURE));
        assert(!ResearchEscrowEip712.isValidFlexibleSignature(SIGNER, wrongDomainDigest, VALID_SIGNATURE));
        assert(!ResearchEscrowEip712.isValidFlexibleSignature(SIGNER, wrongNonceDigest, VALID_SIGNATURE));
    }

    function testAuthorizationWindowRejectsExpiredFutureAndOverlongAuthorizations() public pure {
        assert(ResearchEscrowEip712.isDeadlineLive(1_999_996_300, 1_999_996_300));
        assert(!ResearchEscrowEip712.isDeadlineLive(1_999_996_301, 1_999_996_300));

        assert(
            ResearchEscrowEip712.isAuthorizationWindowLive(
                1_999_998_700, 1_999_999_000, 1_999_998_800, 300, 2_000_000_000
            )
        );
        assert(
            !ResearchEscrowEip712.isAuthorizationWindowLive(
                1_999_998_700, 1_999_999_000, 1_999_999_001, 300, 2_000_000_000
            )
        );
        assert(
            !ResearchEscrowEip712.isAuthorizationWindowLive(
                1_999_998_700, 1_999_999_000, 1_999_998_699, 300, 2_000_000_000
            )
        );
        assert(
            !ResearchEscrowEip712.isAuthorizationWindowLive(
                1_999_998_700, 1_999_999_001, 1_999_998_800, 300, 2_000_000_000
            )
        );
        assert(
            !ResearchEscrowEip712.isAuthorizationWindowLive(
                1_999_998_700, 1_999_999_000, 1_999_998_800, 300, 1_999_998_999
            )
        );
    }

    function _fundingDigest(uint256 nonce) private pure returns (bytes32) {
        return ResearchEscrowEip712.fundingVoucherDigest(CHAIN_ID, FACTORY, _voucher(nonce));
    }

    function _voucher(uint256 nonce) private pure returns (ResearchEscrowEip712.FundingVoucher memory) {
        return ResearchEscrowEip712.FundingVoucher({
            buyer: BUYER,
            researchKey: RESEARCH_KEY,
            budgetUnits: 1_000_000,
            expectedExpiresAt: 2_000_000_000,
            fundingDeadline: 1_999_996_400,
            intentSigner: INTENT_SIGNER,
            voucherNonce: nonce
        });
    }
}

contract MockERC1271Wallet is IERC1271 {
    bytes32 private immutable _ACCEPTED_HASH;
    bytes32 private immutable _ACCEPTED_SIGNATURE_HASH;

    constructor(bytes32 acceptedHash, bytes memory acceptedSignature) {
        _ACCEPTED_HASH = acceptedHash;
        _ACCEPTED_SIGNATURE_HASH = keccak256(acceptedSignature);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (hash == _ACCEPTED_HASH && keccak256(signature) == _ACCEPTED_SIGNATURE_HASH) {
            return IERC1271.isValidSignature.selector;
        }
        return bytes4(0);
    }
}
