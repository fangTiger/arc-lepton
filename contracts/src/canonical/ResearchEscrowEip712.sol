// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

library ResearchEscrowEip712 {
    error ZeroVerifyingContract();
    error InvalidCloseReason();

    string internal constant FACTORY_DOMAIN_NAME = "ArcLeptonResearchEscrowFactory";
    string internal constant ESCROW_DOMAIN_NAME = "ArcLeptonResearchEscrow";
    string internal constant DOMAIN_VERSION = "1";

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant FUNDING_VOUCHER_TYPEHASH = keccak256(
        "FundingVoucher(address buyer,bytes32 researchKey,uint256 budgetUnits,uint64 expectedExpiresAt,uint64 fundingDeadline,address intentSigner,uint256 voucherNonce)"
    );
    bytes32 internal constant ACTIVATION_AUTHORIZATION_TYPEHASH = keccak256(
        "ActivationAuthorization(address escrow,bytes32 researchKey,address buyer,address intentSigner,uint256 initialBudget,uint64 expectedExpiresAt,uint256 activationNonce,uint64 deadline)"
    );
    bytes32 internal constant SETTLEMENT_AUTHORIZATION_TYPEHASH = keccak256(
        "SettlementAuthorization(address escrow,bytes32 researchKey,bytes32 settlementKey,bytes32 itemsHash,uint256 total,uint32 itemCount,uint256 nonce,uint64 issuedAt,uint64 deadline)"
    );
    bytes32 internal constant CLOSE_AUTHORIZATION_TYPEHASH = keccak256(
        "CloseAuthorization(address escrow,bytes32 researchKey,uint8 closeReason,bytes32 finalLiabilityHash,uint256 spent,uint256 nonce,uint64 issuedAt,uint64 deadline)"
    );

    struct FundingVoucher {
        address buyer;
        bytes32 researchKey;
        uint256 budgetUnits;
        uint64 expectedExpiresAt;
        uint64 fundingDeadline;
        address intentSigner;
        uint256 voucherNonce;
    }

    struct ActivationAuthorization {
        address escrow;
        bytes32 researchKey;
        address buyer;
        address intentSigner;
        uint256 initialBudget;
        uint64 expectedExpiresAt;
        uint256 activationNonce;
        uint64 deadline;
    }

    struct SettlementAuthorization {
        address escrow;
        bytes32 researchKey;
        bytes32 settlementKey;
        bytes32 itemsHash;
        uint256 total;
        uint32 itemCount;
        uint256 nonce;
        uint64 issuedAt;
        uint64 deadline;
    }

    struct CloseAuthorization {
        address escrow;
        bytes32 researchKey;
        uint8 closeReason;
        bytes32 finalLiabilityHash;
        uint256 spent;
        uint256 nonce;
        uint64 issuedAt;
        uint64 deadline;
    }

    function factoryDomainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return _domainSeparator(FACTORY_DOMAIN_NAME, chainId, verifyingContract);
    }

    function escrowDomainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return _domainSeparator(ESCROW_DOMAIN_NAME, chainId, verifyingContract);
    }

    function fundingVoucherTypeHash() internal pure returns (bytes32) {
        return FUNDING_VOUCHER_TYPEHASH;
    }

    function activationAuthorizationTypeHash() internal pure returns (bytes32) {
        return ACTIVATION_AUTHORIZATION_TYPEHASH;
    }

    function settlementAuthorizationTypeHash() internal pure returns (bytes32) {
        return SETTLEMENT_AUTHORIZATION_TYPEHASH;
    }

    function closeAuthorizationTypeHash() internal pure returns (bytes32) {
        return CLOSE_AUTHORIZATION_TYPEHASH;
    }

    function hashFundingVoucher(FundingVoucher memory voucher) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FUNDING_VOUCHER_TYPEHASH,
                voucher.buyer,
                voucher.researchKey,
                voucher.budgetUnits,
                voucher.expectedExpiresAt,
                voucher.fundingDeadline,
                voucher.intentSigner,
                voucher.voucherNonce
            )
        );
    }

    function hashActivationAuthorization(ActivationAuthorization memory authorization) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ACTIVATION_AUTHORIZATION_TYPEHASH,
                authorization.escrow,
                authorization.researchKey,
                authorization.buyer,
                authorization.intentSigner,
                authorization.initialBudget,
                authorization.expectedExpiresAt,
                authorization.activationNonce,
                authorization.deadline
            )
        );
    }

    function hashSettlementAuthorization(SettlementAuthorization memory authorization) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SETTLEMENT_AUTHORIZATION_TYPEHASH,
                authorization.escrow,
                authorization.researchKey,
                authorization.settlementKey,
                authorization.itemsHash,
                authorization.total,
                authorization.itemCount,
                authorization.nonce,
                authorization.issuedAt,
                authorization.deadline
            )
        );
    }

    function hashCloseAuthorization(CloseAuthorization memory authorization) internal pure returns (bytes32) {
        _requireCloseReason(authorization.closeReason);

        return keccak256(
            abi.encode(
                CLOSE_AUTHORIZATION_TYPEHASH,
                authorization.escrow,
                authorization.researchKey,
                authorization.closeReason,
                authorization.finalLiabilityHash,
                authorization.spent,
                authorization.nonce,
                authorization.issuedAt,
                authorization.deadline
            )
        );
    }

    function fundingVoucherDigest(uint256 chainId, address factory, FundingVoucher memory voucher)
        internal
        pure
        returns (bytes32)
    {
        return _hashTypedData(factoryDomainSeparator(chainId, factory), hashFundingVoucher(voucher));
    }

    function activationAuthorizationDigest(
        uint256 chainId,
        address escrow,
        ActivationAuthorization memory authorization
    ) internal pure returns (bytes32) {
        return _hashTypedData(escrowDomainSeparator(chainId, escrow), hashActivationAuthorization(authorization));
    }

    function settlementAuthorizationDigest(
        uint256 chainId,
        address escrow,
        SettlementAuthorization memory authorization
    ) internal pure returns (bytes32) {
        return _hashTypedData(escrowDomainSeparator(chainId, escrow), hashSettlementAuthorization(authorization));
    }

    function closeAuthorizationDigest(uint256 chainId, address escrow, CloseAuthorization memory authorization)
        internal
        pure
        returns (bytes32)
    {
        return _hashTypedData(escrowDomainSeparator(chainId, escrow), hashCloseAuthorization(authorization));
    }

    function isValidFlexibleSignature(address signer, bytes32 digest, bytes memory signature)
        internal
        view
        returns (bool)
    {
        if (signer == address(0)) {
            return false;
        }

        return SignatureChecker.isValidSignatureNow(signer, digest, signature);
    }

    function isValidStrictEoaSignature(address signer, bytes32 digest, bytes memory signature)
        internal
        view
        returns (bool)
    {
        if (signer == address(0) || signer.code.length != 0) {
            return false;
        }

        (address recovered, ECDSA.RecoverError error, bytes32 errorArgument) = ECDSA.tryRecover(digest, signature);
        return error == ECDSA.RecoverError.NoError && errorArgument == bytes32(0) && recovered == signer;
    }

    function isDeadlineLive(uint256 currentTime, uint64 deadline) internal pure returns (bool) {
        return currentTime <= deadline;
    }

    function isAuthorizationWindowLive(
        uint64 issuedAt,
        uint64 deadline,
        uint256 currentTime,
        uint64 maxLifetime,
        uint64 expiresAt
    ) internal pure returns (bool) {
        if (issuedAt > deadline) {
            return false;
        }
        if (deadline - issuedAt > maxLifetime) {
            return false;
        }
        if (deadline > expiresAt) {
            return false;
        }

        return currentTime >= issuedAt && currentTime <= deadline;
    }

    function _domainSeparator(string memory name, uint256 chainId, address verifyingContract)
        private
        pure
        returns (bytes32)
    {
        if (verifyingContract == address(0)) {
            revert ZeroVerifyingContract();
        }

        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(DOMAIN_VERSION)),
                chainId,
                verifyingContract
            )
        );
    }

    function _hashTypedData(bytes32 domainSeparator, bytes32 structHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _requireCloseReason(uint8 closeReason) private pure {
        if (closeReason < 1 || closeReason > 3) {
            revert InvalidCloseReason();
        }
    }
}
