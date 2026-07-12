// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice 为后续角色与权限测试提供确定性、互不重叠的身份地址。
abstract contract RoleIsolationFixture {
    address internal constant DEPLOYMENT_KEY = address(0xD001);
    address internal constant FACTORY_ADMIN = address(0xFA01);
    address internal constant REGISTRY_ADMIN = address(0xA001);
    address internal constant SOURCE_ADMIN = address(0x5001);
    address internal constant FUNDING_SIGNER = address(0xF001);
    address internal constant INTENT_SIGNER = address(0x1A01);
    address internal constant SETTLER = address(0x5E77);
    address internal constant BUYER = address(0xB001);
    address internal constant PAYOUT = address(0xCA57);

    function roleAddresses() internal pure returns (address[9] memory roles) {
        roles[0] = DEPLOYMENT_KEY;
        roles[1] = FACTORY_ADMIN;
        roles[2] = REGISTRY_ADMIN;
        roles[3] = SOURCE_ADMIN;
        roles[4] = FUNDING_SIGNER;
        roles[5] = INTENT_SIGNER;
        roles[6] = SETTLER;
        roles[7] = BUYER;
        roles[8] = PAYOUT;
    }
}
