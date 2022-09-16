// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IMIMOSwap.sol";
import "./IMIMOProxyAction.sol";
import "../../proxy/interfaces/IMIMOProxyFactory.sol";

interface IMIMOLeverage is IMIMOSwap, IMIMOProxyAction {
  function leverageOperation(
    IERC20 token,
    uint256 swapAmount,
    uint256 flashloanRepayAmount,
    SwapData calldata swapData
  ) external;

  function proxyFactory() external view returns (IMIMOProxyFactory);
}
