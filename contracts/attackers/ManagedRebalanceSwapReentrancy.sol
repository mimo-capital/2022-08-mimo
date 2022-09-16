// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "../actions/managed/interfaces/IMIMOManagedRebalance.sol";
import "../actions/MIMORebalance.sol";
import "../actions/MIMOSwap.sol";
import "../actions/interfaces/IMIMOFlashLoan.sol";

/// @notice A contract used in MIMO tests that simulates a reentrancy attempt during a managedRebalance swap
/// @dev This contract can be set in the dexAddressProvider and called with any attacking tests
contract ManagedRebalanceSwapReentrancy {
  IMIMOManagedRebalance private _targetContract;
  IMIMOFlashLoan.FlashLoanData private _flData;
  IMIMORebalance.RebalanceData private _rbData;
  IMIMOSwap.SwapData private _swapData;

  /// @notice All arguments needed in the fallback funciton need to be held in storage since the fallback function doesn't take any arguments
  constructor(
    address targetContract,
    IMIMOFlashLoan.FlashLoanData memory flData,
    IMIMORebalance.RebalanceData memory rbData,
    IMIMOSwap.SwapData memory swapData
  ) {
    _targetContract = IMIMOManagedRebalance(targetContract);
    _flData = flData;
    _rbData = rbData;
    _swapData = swapData;
  }

  /// @notice When the low level call is made from the dexAddressProvider, the fallback function will trigger and reenter
  fallback() external payable {
    _targetContract.rebalance(_flData, _rbData, _swapData);
  }
}
