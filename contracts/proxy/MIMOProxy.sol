// SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import "../libraries/BoringBatchable.sol";
import "./interfaces/IMIMOProxy.sol";
import { CustomErrors } from "../libraries/CustomErrors.sol";

/// @title MIMOProxy
/// @notice Used as a proxy to access VaultsCore from a user or a rebalancer
contract MIMOProxy is IMIMOProxy, Initializable, BoringBatchable {
  /// PUBLIC STORAGE ///

  /// @inheritdoc IMIMOProxy
  address public override owner;

  /// @inheritdoc IMIMOProxy
  uint256 public override minGasReserve;

  /// INTERNAL STORAGE ///

  /// @notice Maps envoys to target contracts to function selectors to boolean flags.
  mapping(address => mapping(address => mapping(bytes4 => bool))) internal _permissions;

  /// CONSTRUCTOR ///

  /// @inheritdoc IMIMOProxy
  function initialize() external initializer {
    minGasReserve = 5_000;
    owner = msg.sender;
    emit TransferOwnership(address(0), msg.sender);
  }

  /// FALLBACK FUNCTION ///

  /// @dev Called when Ether is sent and the call data is empty.
  receive() external payable {}

  /// PUBLIC CONSTANT FUNCTIONS ///

  /// @inheritdoc IMIMOProxy
  function getPermission(
    address envoy,
    address target,
    bytes4 selector
  ) external view override returns (bool) {
    return _permissions[envoy][target][selector];
  }

  /// PUBLIC NON-CONSTANT FUNCTIONS ///

  /// @inheritdoc IMIMOProxy
  function execute(address target, bytes calldata data) public payable override returns (bytes memory response) {
    // Check that the caller is either the owner or an envoy.
    if (owner != msg.sender) {
      bytes4 selector;
      assembly {
        selector := calldataload(data.offset)
      }
      if (!_permissions[msg.sender][target][selector]) {
        revert CustomErrors.EXECUTION_NOT_AUTHORIZED(owner, msg.sender, target, selector);
      }
    }

    // Check that the target is a valid contract.
    if (target.code.length == 0) {
      revert CustomErrors.TARGET_INVALID(target);
    }

    // Save the owner address in memory. This local variable cannot be modified during the DELEGATECALL.
    address owner_ = owner;

    // Reserve some gas to ensure that the function has enough to finish the execution.
    uint256 stipend = gasleft() - minGasReserve;

    // Delegate call to the target contract.
    bool success;
    (success, response) = target.delegatecall{ gas: stipend }(data);

    // Check that the owner has not been changed.
    if (owner_ != owner) {
      revert CustomErrors.OWNER_CHANGED(owner_, owner);
    }

    // Log the execution.
    emit Execute(target, data, response);

    // Check if the call was successful or not.
    if (!success) {
      // If there is return data, the call reverted with a reason or a custom error.
      if (response.length > 0) {
        assembly {
          let returndata_size := mload(response)
          revert(add(32, response), returndata_size)
        }
      } else {
        revert CustomErrors.EXECUTION_REVERTED();
      }
    }
  }

  /// @inheritdoc IMIMOProxy
  function setPermission(
    address envoy,
    address target,
    bytes4 selector,
    bool permission
  ) public override {
    if (owner != msg.sender) {
      revert CustomErrors.NOT_OWNER(owner, msg.sender);
    }
    _permissions[envoy][target][selector] = permission;
  }

  /// @inheritdoc IMIMOProxy
  function transferOwnership(address newOwner) external override {
    address oldOwner = owner;
    if (oldOwner != msg.sender) {
      revert CustomErrors.NOT_OWNER(oldOwner, msg.sender);
    }
    owner = newOwner;
    emit TransferOwnership(oldOwner, newOwner);
  }

  /// @inheritdoc IMIMOProxy
  function multicall(address[] calldata targets, bytes[] calldata data) external override returns (bytes[] memory) {
    if (msg.sender != owner) {
      revert CustomErrors.NOT_OWNER(owner, msg.sender);
    }
    bytes[] memory results = new bytes[](data.length);
    for (uint256 i = 0; i < targets.length; i++) {
      (bool success, bytes memory response) = targets[i].call(data[i]);
      if (!success) {
        if (response.length > 0) {
          assembly {
            let returndata_size := mload(response)
            revert(add(32, response), returndata_size)
          }
        } else {
          revert CustomErrors.LOW_LEVEL_CALL_FAILED();
        }
      }
      results[i] = response;
    }
    return results;
  }
}
