// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "./IMIMOSwap.sol";
import "./IMIMOProxyAction.sol";

interface IMIMOEmtpyVault is IMIMOProxyAction, IMIMOSwap {
  function emptyVaultOperation(
    IERC20 vaultCollateral,
    uint256 vaultId,
    uint256 swapAmount,
    SwapData calldata swapData
  ) external;
}
