// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "../../core/dex/interfaces/IDexAddressProvider.sol";

interface IMIMOSwap {
  struct SwapData {
    uint256 dexIndex;
    bytes dexTxData;
  }
}
