// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "./IMIMOProxyFactory.sol";

/// @title IMIMOProxy
/// @notice Proxy contract to compose transactions on owner's behalf.
interface IMIMOProxy {
  event Execute(address indexed target, bytes data, bytes response);

  function execute(address target, bytes calldata data) external payable returns (bytes memory response);

  function proxyFactory() external returns (IMIMOProxyFactory);
}
