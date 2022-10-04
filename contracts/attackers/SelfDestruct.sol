// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

contract SelfDestruct {
  function selfDestruct(address payable to) public {
    selfdestruct(to);
  }
}
