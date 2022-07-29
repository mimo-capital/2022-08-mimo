// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IMIMOSwap.sol";
import { Errors } from "../libraries/Errors.sol";
import { CustomErrors } from "../libraries/CustomErrors.sol";
import "../core/dex/interfaces/IDexAddressProvider.sol";

/**
  @title A modular contract for integrating mimo contracts with dex aggregators
  @dev Supports any aggregators whitelisted by the DexAddressProvider
 */
contract MIMOSwap is IMIMOSwap {
  using SafeERC20 for IERC20;

  IAddressProvider public immutable a;
  IDexAddressProvider public immutable dexAP;

  /**
    @param _a The address of the addressProvider for the MIMO protocol
    @param _dexAP The address of the dexAddressProvider for the MIMO protocol
   */
  constructor(IAddressProvider _a, IDexAddressProvider _dexAP) {
    if (address(_a) == address(0) || address(_dexAP) == address(0)) {
      revert CustomErrors.CANNOT_SET_TO_ADDRESS_ZERO();
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

    require(proxy != address(0), Errors.INVALID_AGGREGATOR);
    require(router != address(0), Errors.INVALID_AGGREGATOR);

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
        revert(Errors.AGGREGATOR_CALL_FAILED);
      }
    }
  }
}
