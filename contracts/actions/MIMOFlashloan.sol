// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPool } from "@aave/core-v3/contracts/interfaces/IPool.sol";
import { Errors } from "../libraries/Errors.sol";
import "./interfaces/IMIMOFlashLoan.sol";

abstract contract MIMOFlashLoan is IMIMOFlashLoan {
  using SafeERC20 for IERC20;

  IPool public immutable lendingPool;

  constructor(IPool _lendingPool) {
    if (address(_lendingPool) == address(0)) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    lendingPool = _lendingPool;
  }

  /**
    @notice Helper function to format arguments to take a flashloan
    @param flData FlashloanData struct containing flashloan asset, amount and params
   */
  function _takeFlashLoan(FlashLoanData memory flData, bytes memory params) internal {
    address[] memory assets = new address[](1);
    uint256[] memory amounts = new uint256[](1);
    uint256[] memory modes = new uint256[](1);
    (assets[0], amounts[0]) = (flData.asset, flData.amount);

    lendingPool.flashLoan(flData.proxyAction, assets, amounts, modes, flData.proxyAction, params, 0);
  }
}
