// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "../actions/automated/interfaces/IMIMOAutoRebalance.sol";
import "../actions/MIMOSwap.sol";

/// @notice A contract used in MIMO tests that simulates a reentrancy attempt during an autoRebalance swap
/// @dev This contract can be set in the dexAddressProvider and called with any attacking tests
contract AutoRebalanceSwapReentrancy {
  IMIMOAutoRebalance private _targetContract;
  uint256 private _vaultId;
  IMIMOSwap.SwapData private _swapData;

  /// @notice All arguments needed in the fallback funciton need to be held in storage since the fallback function doesn't take any arguments
  constructor(
    address targetContract,
    uint256 vaultId,
    IMIMOSwap.SwapData memory swapData
  ) {
    _targetContract = IMIMOAutoRebalance(targetContract);
    _vaultId = vaultId;
    _swapData = swapData;
  }

  /// @notice When the low level call is made from the dexAddressProvider, the fallback function will trigger and reenter
  fallback() external payable {
    _targetContract.rebalance(_vaultId, _swapData);
  }
}
