// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IMIMOSwap.sol";
import { Errors } from "../libraries/Errors.sol";
import "../core/dex/interfaces/IDexAddressProvider.sol";

contract MIMOSwap is IMIMOSwap {
  using SafeERC20 for IERC20;

  IAddressProvider public immutable a;
  IDexAddressProvider public immutable dexAP;

  constructor(IAddressProvider _a, IDexAddressProvider _dexAP) {
    if (address(_a) == address(0) || address(_dexAP) == address(0)) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    a = _a;
    dexAP = _dexAP;
  }

  /**
    @notice Helper function to approve and swap an asset using an aggregator
    @param token The starting token to swap for another asset
    @param amount The amount of starting token to swap for
    @param swapData SwapData containing dex index to use to swap and low-level data to call the aggregator with
   */
  function _aggregatorSwap(
    IERC20 token,
    uint256 amount,
    SwapData calldata swapData
  ) internal {
    (address proxy, address router) = dexAP.getDex(swapData.dexIndex);

    if (proxy == address(0) || router == address(0)) {
      revert Errors.INVALID_AGGREGATOR();
    }

    token.safeIncreaseAllowance(proxy, amount);

    (bool success, bytes memory response) = router.call(swapData.dexTxData);

    if (!success) {
      // If there is return data, the call reverted with a reason or a custom error.
      if (response.length > 0) {
        assembly {
          let returndata_size := mload(response)
          revert(add(32, response), returndata_size)
        }
      } else {
        revert Errors.AGGREGATOR_CALL_FAILED();
      }
    }
  }
}
