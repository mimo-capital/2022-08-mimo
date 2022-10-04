// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "./IMIMOProxy.sol";
import "./IMIMOProxyGuard.sol";

/// @title IMIMOProxyFactory
/// @notice Deploys new proxies with CREATE2.
interface IMIMOProxyFactory {
  struct ProxyState {
    address owner;
    IMIMOProxyGuard proxyGuard;
    uint256 minGas;
  }

  event ProxyDeployed(address indexed owner, address indexed proxy, ProxyState proxyState);

  event PermissionsCleared(address indexed proxy, address newProxyGuard);

  event OwnershipTransferred(address indexed proxy, address indexed previousOwner, address indexed newOwner);

  event OwnershipClaimed(address indexed proxy, address indexed newOwner);

  event MinGasSet(address indexed proxy, uint256 minGas);

  function deploy() external;

  function transferOwnership(address proxy, address newOwner) external;

  function claimOwnership(address proxy, bool clear) external;

  function clearPermissions(address proxy) external;

  function setMinGas(address proxy, uint256 minGas) external;

  function mimoProxyGuardBase() external returns (address);

  function isProxy(address proxy) external returns (bool result);

  function VERSION() external view returns (uint256);

  function getProxyState(address proxy) external view returns (ProxyState memory proxyState);

  function getCurrentProxy(address owner) external view returns (IMIMOProxy proxy);

  function getPendingOwner(address proxy) external view returns (address pendingOwner);
}
