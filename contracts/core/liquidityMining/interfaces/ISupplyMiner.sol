// SPDX-License-Identifier: MIT

pragma experimental ABIEncoderV2;
pragma solidity ^0.8.0;

interface ISupplyMiner {
  function baseDebtChanged(address user, uint256 newBaseDebt) external;
}
