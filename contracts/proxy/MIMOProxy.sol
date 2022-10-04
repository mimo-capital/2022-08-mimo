// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "../libraries/BoringBatchable.sol";
import "./interfaces/IMIMOProxy.sol";
import "./interfaces/IMIMOProxyFactory.sol";
import { Errors } from "../libraries/Errors.sol";

/// @title MIMOProxy
contract MIMOProxy is IMIMOProxy, BoringBatchable {
  /// PUBLIC STORAGE ///
  IMIMOProxyFactory public immutable override proxyFactory;

  /// CONSTRUCTOR ///
  constructor(address _proxyFactory) {
    proxyFactory = IMIMOProxyFactory(_proxyFactory);
  }

  /// FALLBACK FUNCTION ///

  /// @dev Called when Ether is sent and the call data is empty.
  receive() external payable {}

  /// PUBLIC NON-CONSTANT FUNCTIONS ///

  /**
    @notice Delegate calls to the target contract by forwarding the call data. Returns the data it gets back,
    including when the contract call reverts with a reason or custom error
    @dev Requirements:
      - The caller must be either an owner or an envoy
      - `target` must be a deployed contract
      - The owner cannot be changed during the DELEGATECALL
    @param target The address of the target contract
    @param data Function selector plus ABI encoded data
    @return response The response received from the target contract
   */
  function execute(address target, bytes calldata data) public payable override returns (bytes memory response) {
    IMIMOProxyFactory.ProxyState memory state = proxyFactory.getProxyState(address(this));

    // Check that the caller is either the owner or an envoy.
    if (state.owner != msg.sender) {
      bytes4 selector = bytes4(data[:4]);
      if (!state.proxyGuard.getPermission(msg.sender, target, selector)) {
        revert Errors.EXECUTION_NOT_AUTHORIZED(state.owner, msg.sender, target, selector);
      }
    }

    // Check that the target is a valid contract.
    if (target.code.length == 0) {
      revert Errors.TARGET_INVALID(target);
    }

    // Reserve some gas to ensure that the function has enough to finish the execution.
    uint256 stipend = gasleft() - state.minGas;

    // Delegate call to the target contract.
    bool success;
    (success, response) = target.delegatecall{ gas: stipend }(data);

    // Log the execution.
    emit Execute(target, data, response);

    // Check if the call was successful or not.
    if (!success) {
      if (response.length > 0) {
        assembly {
          let returndata_size := mload(response)
          revert(add(32, response), returndata_size)
        }
      } else {
        revert Errors.EXECUTION_REVERTED();
      }
    }
  }
}
