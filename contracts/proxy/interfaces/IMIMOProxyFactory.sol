// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "./IMIMOProxy.sol";

/// @title IMIMOProxyFactory
/// @notice Deploys new proxies with CREATE2.
interface IMIMOProxyFactory {
  /// EVENTS ///

  event DeployProxy(address indexed deployer, address indexed owner, address proxy);

  /// PUBLIC CONSTANT FUNCTIONS ///

  /// @notice Mapping to track all deployed proxies.
  /// @param proxy The address of the proxy to make the check for.
  function isProxy(address proxy) external view returns (bool result);

  /// @notice The release version of PRBProxy.
  /// @dev This is stored in the factory rather than the proxy to save gas for end users.
  function VERSION() external view returns (uint256);

  /// PUBLIC NON-CONSTANT FUNCTIONS ///

  /// @notice Deploys a new proxy 
  /// @dev Sets "msg.sender" as the owner of the proxy.
  /// @return proxy The address of the newly deployed proxy contract.
  function deploy() external returns (IMIMOProxy proxy);

  /// @notice Deploys a new proxy for a given owner and returns the address of the newly created proxy
  /// @param owner The owner of the proxy.
  /// @return proxy The address of the newly deployed proxy contract.
  function deployFor(address owner) external returns (IMIMOProxy proxy);
}
