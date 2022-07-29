// SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4;

import "./interfaces/IMIMOProxy.sol";
import "./interfaces/IMIMOProxyFactory.sol";
import "./interfaces/IMIMOProxyRegistry.sol";
import "../core/interfaces/IAddressProvider.sol";
import "../core/interfaces/IAccessController.sol";
import { CustomErrors } from "../libraries/CustomErrors.sol";

/// @title MIMOProxyRegistry
contract MIMOProxyRegistry is IMIMOProxyRegistry {
  /// PUBLIC STORAGE ///

  /// @inheritdoc IMIMOProxyRegistry
  IMIMOProxyFactory public override factory;

  /// INTERNAL STORAGE ///

  /// @notice Internal mapping of owners to current proxies.
  mapping(address => IMIMOProxy) internal _currentProxies;

  /// CONSTRUCTOR ///

  /// @param factory_ The base contract of the factory
  constructor(IMIMOProxyFactory factory_) {
    factory = factory_;
  }

  /// PUBLIC CONSTANT FUNCTIONS ///

  /// @inheritdoc IMIMOProxyRegistry
  function getCurrentProxy(address owner) external view override returns (IMIMOProxy proxy) {
    proxy = _currentProxies[owner];
  }

  /// PUBLIC NON-CONSTANT FUNCTIONS ///

  /// @inheritdoc IMIMOProxyRegistry
  function deploy() external override returns (IMIMOProxy proxy) {
    proxy = deployFor(msg.sender);
  }

  /// @inheritdoc IMIMOProxyRegistry
  function deployFor(address owner) public override returns (IMIMOProxy proxy) {
    IMIMOProxy currentProxy = _currentProxies[owner];

    // Do not deploy if the proxy already exists and the owner is the same.
    if (address(currentProxy) != address(0) && currentProxy.owner() == owner) {
      revert CustomErrors.PROXY_ALREADY_EXISTS(owner);
    }

    // Deploy the proxy via the factory.
    proxy = factory.deployFor(owner);

    // Set or override the current proxy for the owner.
    _currentProxies[owner] = IMIMOProxy(proxy);
  }
}
