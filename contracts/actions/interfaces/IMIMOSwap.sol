// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../../core/dex/interfaces/IDexAddressProvider.sol";

interface IMIMOSwap {
  struct SwapData {
    uint256 dexIndex;
    bytes dexTxData;
  }

  function dexAP() external returns (IDexAddressProvider);
}
