// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

interface IMIMOProxyAction {
  function executeAction(bytes calldata data) external;
}
