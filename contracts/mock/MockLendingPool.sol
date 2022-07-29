// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "../actions/interfaces/IMIMOFlashloan.sol";

contract MockLendingPool {
  function executeOperation(
    IMIMOFlashloan action,
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external {
    action.executeOperation(assets, amounts, premiums, initiator, params);
  }

  function flashLoan(
    address receiverAddress,
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata interestRateModes,
    address onBehalfOf,
    bytes calldata params,
    uint16 referralCode
  ) external {}
}
