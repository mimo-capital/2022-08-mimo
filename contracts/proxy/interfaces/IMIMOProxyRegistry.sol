// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "./IMIMOProxy.sol";
import "./IMIMOProxyFactory.sol";

/// @title IMIMOProxyRegistry
/// @notice Deploys new proxies via the factory and keeps a registry of owners to proxies. Owners can only
/// have one proxy at a time.
interface IMIMOProxyRegistry {
  /// PUBLIC CONSTANT FUNCTIONS ///

  /// @notice Address of the proxy factory contract.
  function factory() external view returns (IMIMOProxyFactory proxyFactory);

  /// @notice Gets the current proxy of the given owner.
  /// @param owner The address of the owner of the current proxy.
  function getCurrentProxy(address owner) external view returns (IMIMOProxy proxy);

  /// PUBLIC NON-CONSTANT FUNCTIONS ///

  /// @notice Deploys a new proxy instance via the proxy factory.
  /// @dev Sets "msg.sender" as the owner of the proxy.
  ///
  /// Requirements:
  /// - All from "deployFor".
  ///
  /// @return proxy The address of the newly deployed proxy contract.
  function deploy() external returns (IMIMOProxy proxy);

  /// @notice Deploys a new proxy instance via the proxy factory, for the given owner.
  ///
  /// @dev Requirements:
  /// - The proxy must either not exist or its ownership must have been transferred by the owner.
  ///
  /// @param owner The owner of the proxy.
  /// @return proxy The address of the newly deployed proxy contract.
  function deployFor(address owner) external returns (IMIMOProxy proxy);
}
