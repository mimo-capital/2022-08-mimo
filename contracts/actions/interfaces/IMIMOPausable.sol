// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IMIMOPausable {
  event Paused();

  event Unpaused();

  function pause() external;

  function unpause() external;

  function paused() external view returns (bool);
}
