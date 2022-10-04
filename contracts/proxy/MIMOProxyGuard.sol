// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./interfaces/IMIMOProxyFactory.sol";
import "./interfaces/IMIMOProxyGuard.sol";
import { Errors } from "../libraries/Errors.sol";

contract MIMOProxyGuard is IMIMOProxyGuard, Initializable {
  address private _proxy;
  IMIMOProxyFactory private _proxyFactory;

  mapping(address => mapping(address => mapping(bytes4 => bool))) private _permissions;

  /**
    @notice Initializer function to set state variable upon cloning
    @dev Called within same tx as cloning from MIMOProxyFactory
    @param proxyFactory Address of MIMOProxyFactory
    @param proxy Address of the MIMOProxy linked to the contract
   */
  function initialize(address proxyFactory, address proxy) external override initializer {
    if (proxyFactory == address(0) || proxy == address(0)) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    _proxyFactory = IMIMOProxyFactory(proxyFactory);
    _proxy = proxy;
  }

  /**
    @notice Gives or takes a permission from an envoy to call the given target contract and function selector
    on behalf of the owner
    @dev It is not an error to reset a permission on the same (envoy,target,selector) tuple multiple types.
        Requirements:
          - The caller must be the owner or the MIMOProxy
    @param envoy The address of the envoy account
    @param target The address of the target contract
    @param selector The 4 byte function selector on the target contract
    @param permission The boolean permission to set
   */
  function setPermission(
    address envoy,
    address target,
    bytes4 selector,
    bool permission
  ) external override {
    address owner = _proxyFactory.getProxyState(_proxy).owner;
    if (owner != msg.sender && _proxy != msg.sender) {
      revert Errors.UNAUTHORIZED_CALLER();
    }
    _permissions[envoy][target][selector] = permission;
    emit PermissionSet(envoy, target, selector, permission);
  }

  /**
    @param envoy The address of the envoy account
    @param target The address of the target contract
    @param selector The 4 byte function selector on the target contract
    @return permission True if envoys is allowed to perform the call and false if not
   */
  function getPermission(
    address envoy,
    address target,
    bytes4 selector
  ) external view override returns (bool permission) {
    permission = _permissions[envoy][target][selector];
  }

  /// @return proxy Address of the MIMOProxy associated with this contract
  function getProxy() external view override returns (address proxy) {
    proxy = _proxy;
  }

  /// @return proxyFactory Address of the MIMOProxyFactory
  function getProxyFactory() external view override returns (IMIMOProxyFactory proxyFactory) {
    proxyFactory = _proxyFactory;
  }
}
