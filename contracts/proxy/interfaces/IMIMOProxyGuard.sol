// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "./IMIMOProxyFactory.sol";

interface IMIMOProxyGuard {
  event PermissionSet(address indexed envoy, address indexed target, bytes4 selector, bool permission);

  function initialize(address proxyFactory, address proxy) external;

  function setPermission(
    address envoy,
    address target,
    bytes4 selector,
    bool permission
  ) external;

  function getPermission(
    address envoy,
    address target,
    bytes4 selector
  ) external view returns (bool);

  function getProxy() external view returns (address proxy);

  function getProxyFactory() external view returns (IMIMOProxyFactory proxyFactory);
}
