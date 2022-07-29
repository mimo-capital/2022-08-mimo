// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPool } from "@aave/core-v3/contracts/interfaces/IPool.sol";

import { Errors } from "../libraries/Errors.sol";
import { CustomErrors } from "../libraries/CustomErrors.sol";
import "../core/interfaces/IAddressProvider.sol";
import "../proxy/interfaces/IMIMOProxyRegistry.sol";
import "./interfaces/IMIMOFlashloan.sol";

/// @title A modular contract for integrating mimo contracts with AAVE flashloans
contract MIMOFlashloan is IMIMOFlashloan {
  using SafeERC20 for IERC20;

  IPool public immutable lendingPool;

  /// @param _lendingPool The address of the AAVE lending pool
  constructor(IPool _lendingPool) {
    if (address(_lendingPool) == address(0)) {
      revert CustomErrors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    lendingPool = _lendingPool;
  }

  /**
    @notice Handles contract logic after a flashloan is taken. 
    @dev This Integrates with AAVE V3 flashLoans
    @dev This function is called by the lendingPool after _takeFlashLoan from this contract is called 
    @param assets An address array containing the addresses of flashloaned assets
    @param amounts A uint array containing the amounts loaned of the each flashloaned asset 
    @param premiums A uint array containing the flashLoan fees charged for borrowing each asset
    @param initiator The address of the initiator of the flashloan; used to check that only flashloans taken from this contract can do vault operations
    @param params Bytes sent in the _takeFlashLoan calls that encode any additional needed information to complete the transaction 
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external virtual override returns (bool) {}

  /**
    @notice Helper function to format arguments to take a flashloan
    @param flData FlashloanData struct containing flashloan asset, amount and params
    @param params The params that will be sent to the executeOperation function from the flashLoan call 
   */
  function _takeFlashLoan(FlashLoanData memory flData, bytes memory params) internal {
    address[] memory assets = new address[](1);
    uint256[] memory amounts = new uint256[](1);
    uint256[] memory modes = new uint256[](1);
    (assets[0], amounts[0]) = (flData.asset, flData.amount);

    lendingPool.flashLoan(flData.proxyAction, assets, amounts, modes, flData.proxyAction, params, 0);
  }
}
