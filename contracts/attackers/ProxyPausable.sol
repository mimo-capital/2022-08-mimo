// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "../actions/MIMOPausable.sol";
import "../libraries/BoringBatchable.sol";
import "../proxy/interfaces/IMIMOProxy.sol";
import "../proxy/interfaces/IMIMOProxyFactory.sol";
import { Errors } from "../libraries/Errors.sol";

/// @title MIMOProxy
contract ProxyPausable is MIMOPausable, BoringBatchable {
  function execute(address target, bytes calldata data) public payable returns (bytes memory response) {
    // Check that the target is a valid contract.
    if (target.code.length == 0) {
      revert Errors.TARGET_INVALID(target);
    }

    // Delegate call to the target contract.
    bool success;
    (success, response) = target.delegatecall(data);

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
