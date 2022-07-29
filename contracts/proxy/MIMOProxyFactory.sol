// SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/proxy/Clones.sol";

import "./interfaces/IMIMOProxy.sol";
import "./interfaces/IMIMOProxyFactory.sol";
import "./MIMOProxy.sol";

/// @title MIMOProxyFactory
/// @notice Used to make clones of MIMOProxy for each user
contract MIMOProxyFactory is IMIMOProxyFactory {
  using Clones for address;
  /// PUBLIC STORAGE ///

  address public immutable mimoProxyBase;

  /// @inheritdoc IMIMOProxyFactory
  uint256 public constant override VERSION = 1;

  /// INTERNAL STORAGE ///

  /// @dev Internal mapping to track all deployed proxies.
  mapping(address => bool) internal _proxies;

  constructor(address _mimoProxyBase) {
    mimoProxyBase = _mimoProxyBase;
  }

  /// PUBLIC CONSTANT FUNCTIONS ///

  /// @inheritdoc IMIMOProxyFactory
  function isProxy(address proxy) external view override returns (bool result) {
    result = _proxies[proxy];
  }

  /// PUBLIC NON-CONSTANT FUNCTIONS ///

  /// @inheritdoc IMIMOProxyFactory
  function deploy() external override returns (IMIMOProxy proxy) {
    proxy = deployFor(msg.sender);
  }

  /// @inheritdoc IMIMOProxyFactory
  function deployFor(address owner) public override returns (IMIMOProxy proxy) {
    proxy = IMIMOProxy(mimoProxyBase.clone());
    proxy.initialize();

    // Transfer the ownership from this factory contract to the specified owner.
    proxy.transferOwnership(owner);

    // Mark the proxy as deployed.
    _proxies[address(proxy)] = true;

    // Log the proxy via en event.
    emit DeployProxy(msg.sender, owner, address(proxy));
  }
}
