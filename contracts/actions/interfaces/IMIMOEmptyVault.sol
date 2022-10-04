// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "./IMIMOSwap.sol";
import "./IMIMOProxyAction.sol";
import "../../proxy/interfaces/IMIMOProxyFactory.sol";

interface IMIMOEmtpyVault is IMIMOProxyAction, IMIMOSwap {
  function emptyVaultOperation(
    address owner,
    IERC20 vaultCollateral,
    uint256 vaultId,
    uint256 swapAmount,
    uint256 flashloanRepayAmount,
    SwapData calldata swapData
  ) external;

  function proxyFactory() external view returns (IMIMOProxyFactory);
}
