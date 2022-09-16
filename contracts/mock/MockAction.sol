// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

contract MockAction {
  event Deposit();
  event Fallback();

  function deposit() external {
    emit Deposit();
  }

  fallback() external {
    emit Fallback();
  }
}
