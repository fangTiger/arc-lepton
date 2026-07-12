// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ResearchEscrowEip712} from "../../../src/canonical/ResearchEscrowEip712.sol";

contract Eip712VectorsTest {
    uint256 private constant CHAIN_ID = 5_042_002;
    address private constant BUYER = 0x1111111111111111111111111111111111111111;
    address private constant FACTORY = 0x3333333333333333333333333333333333333333;
    address private constant ESCROW = 0x4444444444444444444444444444444444444444;
    address private constant INTENT_SIGNER = 0x5555555555555555555555555555555555555555;

    bytes32 private constant RESEARCH_KEY = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464;
    bytes32 private constant SETTLEMENT_KEY = 0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7;
    bytes32 private constant ITEMS_HASH = 0x97180eb3603765a7d6b345f882b2e54df6caa90acf6f2a372b7b2197fbd707ea;
    bytes32 private constant FINAL_LIABILITY_HASH = 0x338ee25354eba1e0ea3d435dce293825bc9f8143a25d97c1ecfeb5eb29ad3f2e;

    bytes32 private constant FACTORY_DOMAIN_SEPARATOR =
        0x73d91d8af8e8d146fb80a16d4f039d0ba03639ff2b96600b75f97ecb85b6b0fb;
    bytes32 private constant ESCROW_DOMAIN_SEPARATOR =
        0xe157a0fffa62885c5b1c6322e8c521463ee31c1e71a1cd83006996c1fbfab967;

    bytes32 private constant FUNDING_VOUCHER_TYPEHASH =
        0xb0805892b56f982f2a482c934c8b335b8f03c0c25dbbf41bd3bfcc37e9f31c49;
    bytes32 private constant ACTIVATION_AUTHORIZATION_TYPEHASH =
        0xee84862b56bdee65ce26a9db95f7c674354dbcb9ce8e695b627cd3ead1610acb;
    bytes32 private constant SETTLEMENT_AUTHORIZATION_TYPEHASH =
        0xd6023f0cdead08b972e7aecf19e86c43dcfcd7f6e8f04aacd90acc90fe42e160;
    bytes32 private constant CLOSE_AUTHORIZATION_TYPEHASH =
        0xf796cc95366fc26947d8b2475192187551efa93209a231ae85af49aa9b5d0bf5;

    bytes32 private constant FUNDING_VOUCHER_STRUCT_HASH =
        0x21db817e5e68ebffc24c94b86e0737ca03a3663454148eae494c95aac748a6d0;
    bytes32 private constant ACTIVATION_AUTHORIZATION_STRUCT_HASH =
        0xe530ad0fe4e1f8ea3ab712ada561482feb9ca57449d7e5cbea107a1021f57685;
    bytes32 private constant SETTLEMENT_AUTHORIZATION_STRUCT_HASH =
        0x9d655b7102e2606ab21533fe9ad912c92926ffd0c6ab6e86bd7dbd3680eb9d1c;
    bytes32 private constant CLOSE_AUTHORIZATION_STRUCT_HASH =
        0x970b65f92a321629d4e92336f5a33d23132f7ede8653fa8ce19c2f19701c38a6;

    bytes32 private constant FUNDING_VOUCHER_DIGEST =
        0x8faa9182addb6d5d08af23306436f3306498c84252c9ed09d88f3c6fd8eff95b;
    bytes32 private constant ACTIVATION_AUTHORIZATION_DIGEST =
        0xbc1cbf4093c2e740f17393d450269fed5983c790354666867f34bd8a4949e6d7;
    bytes32 private constant SETTLEMENT_AUTHORIZATION_DIGEST =
        0xb3b9a8aa53892c97a11bea76829a29d72741f75bc6e0046ae69c0fcdeb3712b2;
    bytes32 private constant CLOSE_AUTHORIZATION_DIGEST =
        0x00b2124a61089fcd6b75eadd2b33a5c8876165709f25ccba22a38a213f5139ba;

    function testDomainSeparatorsMatchSharedVectors() public pure {
        assert(ResearchEscrowEip712.factoryDomainSeparator(CHAIN_ID, FACTORY) == FACTORY_DOMAIN_SEPARATOR);
        assert(ResearchEscrowEip712.escrowDomainSeparator(CHAIN_ID, ESCROW) == ESCROW_DOMAIN_SEPARATOR);
    }

    function testTypeHashesMatchCanonicalTypeStrings() public pure {
        assert(ResearchEscrowEip712.fundingVoucherTypeHash() == FUNDING_VOUCHER_TYPEHASH);
        assert(ResearchEscrowEip712.activationAuthorizationTypeHash() == ACTIVATION_AUTHORIZATION_TYPEHASH);
        assert(ResearchEscrowEip712.settlementAuthorizationTypeHash() == SETTLEMENT_AUTHORIZATION_TYPEHASH);
        assert(ResearchEscrowEip712.closeAuthorizationTypeHash() == CLOSE_AUTHORIZATION_TYPEHASH);
    }

    function testStructHashesMatchSharedVectors() public pure {
        assert(ResearchEscrowEip712.hashFundingVoucher(_fundingVoucher()) == FUNDING_VOUCHER_STRUCT_HASH);
        assert(
            ResearchEscrowEip712.hashActivationAuthorization(_activationAuthorization())
                == ACTIVATION_AUTHORIZATION_STRUCT_HASH
        );
        assert(
            ResearchEscrowEip712.hashSettlementAuthorization(_settlementAuthorization())
                == SETTLEMENT_AUTHORIZATION_STRUCT_HASH
        );
        assert(ResearchEscrowEip712.hashCloseAuthorization(_closeAuthorization()) == CLOSE_AUTHORIZATION_STRUCT_HASH);
    }

    function testTypedDataDigestsMatchSharedVectors() public pure {
        assert(
            ResearchEscrowEip712.fundingVoucherDigest(CHAIN_ID, FACTORY, _fundingVoucher()) == FUNDING_VOUCHER_DIGEST
        );
        assert(
            ResearchEscrowEip712.activationAuthorizationDigest(CHAIN_ID, ESCROW, _activationAuthorization())
                == ACTIVATION_AUTHORIZATION_DIGEST
        );
        assert(
            ResearchEscrowEip712.settlementAuthorizationDigest(CHAIN_ID, ESCROW, _settlementAuthorization())
                == SETTLEMENT_AUTHORIZATION_DIGEST
        );
        assert(
            ResearchEscrowEip712.closeAuthorizationDigest(CHAIN_ID, ESCROW, _closeAuthorization())
                == CLOSE_AUTHORIZATION_DIGEST
        );
    }

    function _fundingVoucher() private pure returns (ResearchEscrowEip712.FundingVoucher memory) {
        return ResearchEscrowEip712.FundingVoucher({
            buyer: BUYER,
            researchKey: RESEARCH_KEY,
            budgetUnits: 1_000_000,
            expectedExpiresAt: 2_000_000_000,
            fundingDeadline: 1_999_996_400,
            intentSigner: INTENT_SIGNER,
            voucherNonce: 7
        });
    }

    function _activationAuthorization() private pure returns (ResearchEscrowEip712.ActivationAuthorization memory) {
        return ResearchEscrowEip712.ActivationAuthorization({
            escrow: ESCROW,
            researchKey: RESEARCH_KEY,
            buyer: BUYER,
            intentSigner: INTENT_SIGNER,
            initialBudget: 1_000_000,
            expectedExpiresAt: 2_000_000_000,
            activationNonce: 8,
            deadline: 1_999_996_300
        });
    }

    function _settlementAuthorization() private pure returns (ResearchEscrowEip712.SettlementAuthorization memory) {
        return ResearchEscrowEip712.SettlementAuthorization({
            escrow: ESCROW,
            researchKey: RESEARCH_KEY,
            settlementKey: SETTLEMENT_KEY,
            itemsHash: ITEMS_HASH,
            total: 100,
            itemCount: 1,
            nonce: 9,
            issuedAt: 1_999_998_700,
            deadline: 1_999_999_000
        });
    }

    function _closeAuthorization() private pure returns (ResearchEscrowEip712.CloseAuthorization memory) {
        return ResearchEscrowEip712.CloseAuthorization({
            escrow: ESCROW,
            researchKey: RESEARCH_KEY,
            closeReason: 1,
            finalLiabilityHash: FINAL_LIABILITY_HASH,
            spent: 100,
            nonce: 10,
            issuedAt: 1_999_998_700,
            deadline: 1_999_999_000
        });
    }
}
