// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

/**
    @title Errors library
    @author MIMO
    @notice Defines the error messages emtted by the different contracts of the MIMO protocol
 */

library Errors {
  string public constant INVALID_AGGREGATOR = "1";
  string public constant AGGREGATOR_CALL_FAILED = "2";
  string public constant CANNOT_REPAY_FLASHLOAN = "3";
}
