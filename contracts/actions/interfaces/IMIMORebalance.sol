// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "./IMIMOSwap.sol";
import "./IMIMOProxyAction.sol";
import "../../proxy/interfaces/IMIMOProxyFactory.sol";

interface IMIMORebalance is IMIMOProxyAction, IMIMOSwap {
  struct RebalanceData {
    IERC20 toCollateral;
    uint256 vaultId;
    uint256 mintAmount;
  }

  function rebalanceOperation(
    IERC20 fromCollateral,
    uint256 swapAmount,
    uint256 flashloanRepayAmount,
    uint256 fee,
    RebalanceData calldata rbData,
    SwapData calldata swapData
  ) external;

  function proxyFactory() external view returns (IMIMOProxyFactory);
}
