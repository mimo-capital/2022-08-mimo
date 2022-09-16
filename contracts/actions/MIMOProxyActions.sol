// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "../proxy/interfaces/IMIMOProxy.sol";
import { Errors } from "../libraries/Errors.sol";

contract MIMOProxyActions {
  /**
    @notice Sends ETH back to owner of the MIMOProxy
    Can only be called by MIMOProxy owner
   */
  function withdrawETH() external payable {
    (bool success, bytes memory response) = IMIMOProxy(address(this))
      .proxyFactory()
      .getProxyState(address(this))
      .owner
      .call{ value: address(this).balance }("");
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

  /**
    @notice Call multiple functions from current contract and return the data from all of them if they all succeed
    @param targets Address array of all contracts to call
    @param data Bytes array of encoded function data for each target call
   */
  function multicall(address[] calldata targets, bytes[] calldata data) external returns (bytes[] memory) {
    if (targets.length != data.length) {
      revert Errors.TARGETS_LENGTH_DIFFERENT_THAN_DATA_LENGTH(targets.length, data.length);
    }
    bytes[] memory results = new bytes[](data.length);
    for (uint256 i = 0; i < targets.length; i++) {
      // Check that the target is a valid contract.
      if (targets[i].code.length == 0) {
        revert Errors.TARGET_INVALID(targets[i]);
      }
      (bool success, bytes memory response) = targets[i].call(data[i]);
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
      results[i] = response;
    }
    return results;
  }
}
