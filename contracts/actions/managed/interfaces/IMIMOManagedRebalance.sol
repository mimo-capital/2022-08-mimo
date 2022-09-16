// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IMIMOManagedAction.sol";
import "../../interfaces/IMIMOFlashLoan.sol";
import "../../interfaces/IMIMORebalance.sol";
import "../../interfaces/IMIMOSwap.sol";

interface IMIMOManagedRebalance is IMIMOManagedAction {
  function rebalance(
    IMIMOFlashLoan.FlashLoanData calldata flData,
    IMIMORebalance.RebalanceData calldata rbData,
    IMIMOSwap.SwapData calldata swapData
  ) external;
}
