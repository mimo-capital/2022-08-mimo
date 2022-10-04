// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "./interfaces/IMIMOPausable.sol";
import "../libraries/BoringOwnable.sol";
import { Errors } from "../libraries/Errors.sol";

contract MIMOPausable is IMIMOPausable, BoringOwnable {
  bool private _paused;

  modifier whenNotPaused() virtual {
    if (_paused) {
      revert Errors.PAUSED();
    }
    _;
  }

  function pause() external override onlyOwner {
    _paused = true;
    emit Paused();
  }

  function unpause() external override onlyOwner {
    _paused = false;
    emit Unpaused();
  }

  function paused() external view override returns (bool) {
    return _paused;
  }
}
