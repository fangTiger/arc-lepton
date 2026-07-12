// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice 只用于证明 unit、fuzz 与 invariant 命令确实命中测试。
contract ToolingInvariantTarget {
    uint256 private observed;

    function setObserved(uint256 value) public {
        observed = value % 2;
    }

    function readObserved() public view returns (uint256) {
        return observed;
    }
}

/// @notice 部署独立 handler，让 Foundry invariant runner 有真实调用目标。
contract ToolingProfilesTest {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    ToolingInvariantTarget private target;

    function setUp() public {
        target = new ToolingInvariantTarget();
    }

    function testFuzzXorRoundTrip(uint256 value) public pure {
        assert((value ^ value) == 0);
    }

    function invariant_observedRemainsBounded() public view {
        assert(target.readObserved() < 2);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(target);
    }

    function excludeContracts() public pure returns (address[] memory) {
        return new address[](0);
    }

    function targetSenders() public pure returns (address[] memory) {
        return new address[](0);
    }

    function excludeSenders() public pure returns (address[] memory) {
        return new address[](0);
    }

    function targetArtifacts() public pure returns (string[] memory) {
        return new string[](0);
    }

    function excludeArtifacts() public pure returns (string[] memory) {
        return new string[](0);
    }

    function targetSelectors() public pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function excludeSelectors() public pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function targetArtifactSelectors() public pure returns (FuzzArtifactSelector[] memory) {
        return new FuzzArtifactSelector[](0);
    }

    function targetInterfaces() public pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }
}
