// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IMIMOManagedAction.sol";
import "../../interfaces/IMIMOFlashloan.sol";
import "../../interfaces/IMIMORebalance.sol";
import "../../interfaces/IMIMOSwap.sol";

interface IMIMOManagedRebalance is IMIMOManagedAction {
  function rebalance(
    IMIMOFlashloan.FlashLoanData calldata flData,
    IMIMORebalance.RebalanceData calldata rbData,
    IMIMOSwap.SwapData calldata swapData
  ) external;
}
