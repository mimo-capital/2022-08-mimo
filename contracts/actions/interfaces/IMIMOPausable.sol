// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IMIMOPausable {
  function pause() external;

  function unpause() external;

  function paused() external view returns (bool);
}
