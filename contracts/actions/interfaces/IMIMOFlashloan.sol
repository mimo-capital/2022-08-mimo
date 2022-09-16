// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPool } from "@aave/core-v3/contracts/interfaces/IPool.sol";

import "./IMIMOProxyAction.sol";
import "../../core/interfaces/IAddressProvider.sol";

interface IMIMOFlashLoan {
  struct FlashLoanData {
    address asset;
    address proxyAction;
    uint256 amount;
  }

  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external returns (bool);

  function lendingPool() external returns (IPool);
}
