// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IMIMOProxyAction {
  function executeAction(bytes calldata data) external;
}
