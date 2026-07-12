// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

interface IResearchEscrowFactoryBinding {
    function registry() external view returns (address);
    function usdc() external view returns (address);
}

interface IAccessControlRoleProbe {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

contract DataSourceRegistry is AccessControlEnumerable {
    error ZeroAddress();
    error ZeroSourceId();
    error ZeroMaxUnitPrice();
    error FactoryAlreadyBound();
    error FactoryCodeMissing(address factory);
    error FactoryWiringInvalid(address factory);
    error FactoryNotBound();
    error SourceAlreadyExists(bytes32 sourceId);
    error SourceMissing(bytes32 sourceId);
    error RevisionOverflow(bytes32 sourceId);
    error SourceMustStartActive(bytes32 sourceId);
    error SensitivePayout(address payout);
    error SensitiveRoleConflict(address account, bytes32 role, address authority);

    bytes32 public constant SOURCE_ADMIN_ROLE = keccak256("SOURCE_ADMIN_ROLE");
    bytes32 public constant FUNDING_SIGNER_ROLE = keccak256("FUNDING_SIGNER_ROLE");
    bytes32 public constant INTENT_SIGNER_ROLE = keccak256("INTENT_SIGNER_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    address private constant ARC_NATIVE_USDC_SYSTEM_EMITTER = address(uint160(type(uint160).max - 1));

    function usdc() external pure returns (address) {
        return ARC_TESTNET_USDC;
    }

    address public factory;

    struct SourceConfig {
        uint64 revision;
        address payout;
        uint256 maxUnitPrice;
        bool active;
    }

    mapping(bytes32 sourceId => SourceConfig config) private _sources;

    event FactoryBound(address indexed factory);
    event SourceConfigured(
        bytes32 indexed sourceId, uint64 indexed revision, address payout, uint256 maxUnitPrice, bool active
    );

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }

    function bindFactory(address factory_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (factory != address(0)) {
            revert FactoryAlreadyBound();
        }
        if (factory_ == address(0)) {
            revert ZeroAddress();
        }
        if (factory_.code.length == 0) {
            revert FactoryCodeMissing(factory_);
        }
        if (!_hasExpectedFactoryWiring(factory_)) {
            revert FactoryWiringInvalid(factory_);
        }

        factory = factory_;
        emit FactoryBound(factory_);
    }

    function createSource(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active)
        external
        onlyRole(SOURCE_ADMIN_ROLE)
    {
        _requireFactoryBound();
        _requireValidSourceInputs(sourceId, payout, maxUnitPrice);
        if (!active) {
            revert SourceMustStartActive(sourceId);
        }

        SourceConfig storage config = _sources[sourceId];
        if (config.revision != 0) {
            revert SourceAlreadyExists(sourceId);
        }

        _writeSource(sourceId, payout, maxUnitPrice, active, 1);
    }

    function updateSource(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active)
        external
        onlyRole(SOURCE_ADMIN_ROLE)
    {
        _requireFactoryBound();
        _requireValidSourceInputs(sourceId, payout, maxUnitPrice);

        SourceConfig storage config = _sources[sourceId];
        uint64 revision = config.revision;
        if (revision == 0) {
            revert SourceMissing(sourceId);
        }
        if (revision == type(uint64).max) {
            revert RevisionOverflow(sourceId);
        }

        _writeSource(sourceId, payout, maxUnitPrice, active, revision + 1);
    }

    function getSource(bytes32 sourceId)
        external
        view
        returns (uint64 revision, address payout, uint256 maxUnitPrice, bool active)
    {
        SourceConfig memory config = _sources[sourceId];
        return (config.revision, config.payout, config.maxUnitPrice, config.active);
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        _requireNoSensitiveRoleConflict(role, account);

        return super._grantRole(role, account);
    }

    function _forceSourceForTest(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active, uint64 revision)
        internal
    {
        _sources[sourceId] =
            SourceConfig({revision: revision, payout: payout, maxUnitPrice: maxUnitPrice, active: active});
    }

    function _writeSource(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active, uint64 revision)
        private
    {
        _sources[sourceId] =
            SourceConfig({revision: revision, payout: payout, maxUnitPrice: maxUnitPrice, active: active});
        emit SourceConfigured(sourceId, revision, payout, maxUnitPrice, active);
    }

    function _requireFactoryBound() private view {
        if (factory == address(0)) {
            revert FactoryNotBound();
        }
    }

    function _requireValidSourceInputs(bytes32 sourceId, address payout, uint256 maxUnitPrice) private view {
        if (sourceId == bytes32(0)) {
            revert ZeroSourceId();
        }
        if (payout == address(0)) {
            revert ZeroAddress();
        }
        if (maxUnitPrice == 0) {
            revert ZeroMaxUnitPrice();
        }
        if (
            payout == address(this) || payout == factory || payout == ARC_TESTNET_USDC
                || payout == ARC_NATIVE_USDC_SYSTEM_EMITTER
        ) {
            revert SensitivePayout(payout);
        }
    }

    function _requireNoSensitiveRoleConflict(bytes32 role, address account) private view {
        if (!_isRegistrySensitiveRole(role)) {
            return;
        }
        if (factory == address(0)) {
            if (role == SOURCE_ADMIN_ROLE) {
                revert FactoryNotBound();
            }
            return;
        }

        if (role == SOURCE_ADMIN_ROLE && hasRole(DEFAULT_ADMIN_ROLE, account)) {
            revert SensitiveRoleConflict(account, DEFAULT_ADMIN_ROLE, address(this));
        }
        if (role == DEFAULT_ADMIN_ROLE && hasRole(SOURCE_ADMIN_ROLE, account)) {
            revert SensitiveRoleConflict(account, SOURCE_ADMIN_ROLE, address(this));
        }

        _requireNoFactoryRole(account, DEFAULT_ADMIN_ROLE);
        _requireNoFactoryRole(account, FUNDING_SIGNER_ROLE);
        _requireNoFactoryRole(account, INTENT_SIGNER_ROLE);
        _requireNoFactoryRole(account, SETTLER_ROLE);
    }

    function _requireNoFactoryRole(address account, bytes32 role) private view {
        (bool success, bytes memory data) =
            factory.staticcall(abi.encodeCall(IAccessControlRoleProbe.hasRole, (role, account)));
        if (success && data.length == 32 && abi.decode(data, (bool))) {
            revert SensitiveRoleConflict(account, role, factory);
        }
    }

    function _isRegistrySensitiveRole(bytes32 role) private pure returns (bool) {
        return role == DEFAULT_ADMIN_ROLE || role == SOURCE_ADMIN_ROLE;
    }

    function _hasExpectedFactoryWiring(address factory_) private view returns (bool) {
        try IResearchEscrowFactoryBinding(factory_).registry() returns (address registry_) {
            if (registry_ != address(this)) {
                return false;
            }
        } catch {
            return false;
        }

        try IResearchEscrowFactoryBinding(factory_).usdc() returns (address usdc_) {
            return usdc_ == ARC_TESTNET_USDC;
        } catch {
            return false;
        }
    }
}
