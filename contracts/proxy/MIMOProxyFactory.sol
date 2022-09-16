// SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/proxy/Clones.sol";

import "./interfaces/IMIMOProxyFactory.sol";
import "./MIMOProxy.sol";
import { Errors } from "../libraries/Errors.sol";

/// @title MIMOProxyFactory
contract MIMOProxyFactory is IMIMOProxyFactory {
  using Clones for address;

  address public immutable mimoProxyGuardBase;

  /// @inheritdoc IMIMOProxyFactory
  uint256 public constant override VERSION = 1;

  /// @notice proxy => proxy state
  mapping(address => ProxyState) private _proxyStates;

  /// @notice owner => proxy
  mapping(address => IMIMOProxy) private _currentProxies;

  /// @notice proxy => pending owner
  mapping(address => address) private _pendingOwners;

  modifier onlyOwner(address proxy) {
    if (address(_currentProxies[msg.sender]) != proxy) {
      revert Errors.NOT_OWNER(_proxyStates[proxy].owner, msg.sender);
    }
    _;
  }

  constructor(address _mimoProxyGuardBase) {
    if (_mimoProxyGuardBase == address(0)) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    mimoProxyGuardBase = _mimoProxyGuardBase;
  }

  /**
    @notice Deploys a new MIMOProxy and MIMOProxyGuard
    @dev Sets "msg.sender" as the owner of the MIMOProxy.

   */
  function deploy() external override {
    address currentProxy = address(_currentProxies[msg.sender]);
    if (address(currentProxy) != address(0)) {
      revert Errors.ALREADY_OWNER(msg.sender, currentProxy);
    }
    MIMOProxy proxy = new MIMOProxy(address(this));
    IMIMOProxyGuard proxyGuard = IMIMOProxyGuard(mimoProxyGuardBase.clone());

    proxyGuard.initialize(address(this), address(proxy));

    ProxyState memory proxyState = ProxyState({ owner: msg.sender, proxyGuard: proxyGuard, minGas: 5000 });

    _currentProxies[msg.sender] = IMIMOProxy(proxy);
    _proxyStates[address(proxy)] = proxyState;

    emit ProxyDeployed(msg.sender, address(proxy), proxyState);
  }

  /**
    @notice Transfers ownership to `newOwner`. Either directly or claimable by the new pending owner.
    Can only be invoked by the current MIMOProxy `owner`
    @param proxy Address ot the MIMOProxy to transfer
    @param newOwner Address of the new owner
   */
  function transferOwnership(address proxy, address newOwner) external override onlyOwner(proxy) {
    // Checks
    if (newOwner == address(0)) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    if (address(_currentProxies[newOwner]) != address(0)) {
      revert Errors.ALREADY_OWNER(newOwner, address(_currentProxies[newOwner]));
    }
    // Effects
    _pendingOwners[proxy] = newOwner;
    emit OwnershipTransferred(proxy, msg.sender, newOwner);
  }

  /**
    @notice Needs to be called by `pendingOwner` to claim ownership
    @param proxy Address of the MIMOProxy to claim
    @param clear Clear existing proxy permissions if true and maintain them if false
   */
  function claimOwnership(address proxy, bool clear) external override {
    address pendingOwner = _pendingOwners[proxy];

    // Checks
    if (msg.sender != pendingOwner) {
      revert Errors.CALLER_NOT_PENDING_OWNER(msg.sender, pendingOwner);
    }

    if (address(_currentProxies[pendingOwner]) != address(0)) {
      revert Errors.ALREADY_OWNER(pendingOwner, address(_currentProxies[pendingOwner]));
    }

    // Effects
    address oldOwner = _proxyStates[proxy].owner;
    delete _currentProxies[oldOwner];
    _currentProxies[msg.sender] = IMIMOProxy(proxy);
    _proxyStates[proxy].owner = msg.sender;
    delete _pendingOwners[proxy];
    emit OwnershipClaimed(proxy, msg.sender);

    if (clear) {
      _clearPermissions(proxy);
    }
  }

  /**
    @notice Clear all permissions from the MIMOProxy by deploying a new MIMOProxyGuard
    Can only be called by the MIMOProxy `owner`
    @param proxy Addess of the MIMOProxy to clear
   */
  function clearPermissions(address proxy) external override onlyOwner(proxy) {
    _clearPermissions(proxy);
  }

  /**
    @param proxy Address of the MIMOProxy
    @param minGas Gas to reserve for running the remainder of the "execute" function after the DELEGATECALL in the 
    MIMOProxy. Prevents the proxy from becoming unusable if EVM opcode gas costs change in the future.
   */
  function setMinGas(address proxy, uint256 minGas) external override onlyOwner(proxy) {
    _proxyStates[proxy].minGas = minGas;
    emit MinGasSet(proxy, minGas);
  }

  /**
    @param proxy Address of the MIMOProxy to check
    @return result equals true if proxy has been deployed and false if not
   */
  function isProxy(address proxy) external view override returns (bool result) {
    result = _proxyStates[proxy].owner != address(0);
  }

  /**
    @notice Returns a MIMOProxy state
    @dev MIMOProxy state management is outsourced to this contract to prevent storage collisions
    @param proxy Address of the MIMOProxy
    @return proxyState as a ProxyState struct containing a MIMOProxy state variables
   */
  function getProxyState(address proxy) external view override returns (ProxyState memory proxyState) {
    proxyState = _proxyStates[proxy];
  }

  /**
    @notice Gets the current MIMOProxy of the given owner.
    @param owner The address of the owner of the current MIMOProxy.
   */
  function getCurrentProxy(address owner) external view override returns (IMIMOProxy proxy) {
    proxy = _currentProxies[owner];
  }

  /**
    @param proxy Address of the MIMOProxy
    @return pendingOwner that has yet to claim his ownership
   */
  function getPendingOwner(address proxy) external view override returns (address pendingOwner) {
    pendingOwner = _pendingOwners[proxy];
  }

  function _clearPermissions(address proxy) internal {
    IMIMOProxyGuard proxyGuard = IMIMOProxyGuard(mimoProxyGuardBase.clone());
    proxyGuard.initialize(address(this), proxy);
    _proxyStates[proxy].proxyGuard = proxyGuard;

    emit PermissionsCleared(proxy, address(proxyGuard));
  }
}
