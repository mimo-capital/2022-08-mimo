// SPDX-License-Identifier: MIT
pragma experimental ABIEncoderV2;
pragma solidity ^0.8.0;

import "../../interfaces/IAddressProvider.sol";

interface IDexAddressProvider {
  struct Dex {
    address proxy;
    address router;
  }

  event DexSet(uint256 index, address proxy, address router);

  function setDexMapping(
    uint256 _index,
    address _proxy,
    address _dex
  ) external;

  function a() external view returns (IAddressProvider);

  function getDex(uint256 index) external view returns (address, address);
}
