// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

/**
    @title Errors library
    @author MIMO
    @notice Defines the error messages emtted by the different contracts of the MIMO protocol
 */

library CustomErrors {
  error CANNOT_SET_TO_ADDRESS_ZERO();
  error INITIATOR_NOT_AUTHORIZED(address actual, address expected);
  error CALLER_NOT_LENDING_POOL(address actual, address expected);
  error CANNOT_REPAY_FLASHLOAN();
  error INVALID_AGGREGATOR();
  error AGGREGATOR_CALL_FAILED();
  error EXECUTION_NOT_AUTHORIZED(address owner, address caller, address target, bytes4 selector);
  error EXECUTION_REVERTED();
  error NOT_OWNER(address owner, address caller);
  error OWNER_CHANGED(address originalOwner, address newOwner);
  error TARGET_INVALID(address target);
  error CALLER_NOT_VAULT_OWNER(address callerProxy, address vaultOwner);
  error CALLER_NOT_PROTOCOL_MANAGER();
  error MANAGER_NOT_LISTED();
  error VAULT_NOT_UNDER_MANAGEMENT();
  error CALLER_NOT_SELECTED_MANAGER();
  error PROXY_ALREADY_EXISTS(address owner);
  error MAX_OPERATIONS_REACHED();
  error MINT_AMOUNT_GREATER_THAN_VAULT_DEBT();
  error VAULT_VALUE_CHANGE_TOO_HIGH();
  error FINAL_VAULT_RATIO_TOO_LOW(uint256 minRatio, uint256 actualRatio);
  error VAULT_NOT_AUTOMATED();
  error VAULT_TRIGGER_RATIO_NOT_REACHED(uint256 actual, uint256 expected);
  error TARGETS_LENGTH_DIFFERENT_THAN_DATA_LENGTH(uint256 targetsLength, uint256 dataLength);
  error LOW_LEVEL_CALL_FAILED();
  error REBALANCE_AMOUNT_CANNOT_BE_ZERO();
  error VARIABLE_FEE_TOO_HIGH(uint256 maxVarFee, uint256 actualVarFee);
}
