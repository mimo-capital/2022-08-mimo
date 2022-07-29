// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IMIMOAutoAction.sol";
import "../../interfaces/IMIMOSwap.sol";

interface IMIMOAutoRebalance is IMIMOAutoAction {
  function rebalance(uint256 vaultId, IMIMOSwap.SwapData calldata swapData) external;

  function getAmounts(uint256 vaultId, address toCollateral)
    external
    returns (
      uint256 rebalanceAmount,
      uint256 mintAmount,
      uint256 autoFee
    );
}
