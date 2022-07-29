// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IMIMOVaultActions.sol";
import { CustomErrors } from "../libraries/CustomErrors.sol";
import "../core/interfaces/IVaultsCore.sol";
import "../core/interfaces/IVaultsDataProvider.sol";

/**
  @title Basic helper logic.
  @notice Only intended to be hold the logic for paking delegateCalls from a MIMOProxy
 */
contract MIMOVaultActions is IMIMOVaultActions {
  using SafeERC20 for IERC20;

  IVaultsCore public immutable core;
  IVaultsDataProvider public immutable vaultsData;
  IERC20 public immutable stablex;

  /**
    @param _core The address of the MIMO protocol VaultsCore
    @param _vaultsData The address of MIMO VaultsDataProvider
    @param _stablex The address of the _stablex associated with the vaultsCore
   */
  constructor(
    IVaultsCore _core,
    IVaultsDataProvider _vaultsData,
    IERC20 _stablex
  ) {
    if (address(_core) == address(0) || address(_vaultsData) == address(0) || address(_stablex) == address(0)) {
      revert CustomErrors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    core = _core;
    vaultsData = _vaultsData;
    stablex = _stablex;
  }

  /**
    @notice Deposit collateral into a vault through a delegatecall to a MIMOProxy clone.
    @notice Requires approval of asset for amount before calling
    @param collateral Address of the collateral type
    @param amount Amount to deposit
   */
  function deposit(IERC20 collateral, uint256 amount) external override {
    collateral.safeTransferFrom(msg.sender, address(this), amount);
    collateral.safeIncreaseAllowance(address(core), amount);
    core.deposit(address(collateral), amount);
  }

  /// @notice Wrap ETH and deposit WETH as collateral into a vault, all through a delegatecall to a MIMOProxy clone.
  function depositETH() external payable override {
    core.depositETH{ value: msg.value }();
  }

  /**
    @notice Deposit collateral into a vault and borrow PAR, all through a delegatecall to a MIMOProxy clone.
    @notice Requires approval of asset for amount before calling
    @param collateral The collateral to deposit
    @param depositAmount Amount to deposit
    @param borrowAmount Amount of PAR to borrow after depositing
   */
  function depositAndBorrow(
    IERC20 collateral,
    uint256 depositAmount,
    uint256 borrowAmount
  ) external override {
    IVaultsCore core_ = core;
    collateral.safeTransferFrom(msg.sender, address(this), depositAmount);
    collateral.safeIncreaseAllowance(address(core_), depositAmount);
    core_.depositAndBorrow(address(collateral), depositAmount, borrowAmount);
  }

  /**
    @notice Wrap ETH and deposit WETH as collateral into a vault, then borrow PAR from vault, all through a delegatecall to a MIMOProxy clone.
    @param borrowAmount The amount of PAR to borrow after depositing ETH
   */
  function depositETHAndBorrow(uint256 borrowAmount) external payable override {
    core.depositETHAndBorrow{ value: msg.value }(borrowAmount);
  }

  /**
    @notice Withdraw collateral from a vault through a delegatecall to a MIMOProxy clone.
    @notice Vault must have been created through the MIMOProxy contract
    @notice Use this instead of emptyvault when the vault you are trying to withdraw from doesn't have any outstanding debt
    @param vaultId The ID of the vault to withdraw from
    @param amount The amount of collateral to withdraw
   */
  function withdraw(uint256 vaultId, uint256 amount) external override {
    core.withdraw(vaultId, amount);
  }

  /**
    @notice Withdraw WETH from a vault and return to the user as ETH through a delegatecall to a MIMOProxy clone.
    @param vaultId The ID of the vault to withdraw from
    @param amount The amount of ETH to withdraw
   */
  function withdrawETH(uint256 vaultId, uint256 amount) external override {
    core.withdrawETH(vaultId, amount);
  }

  /**
    @notice Borrow PAR from a vault
    @param vaultId The ID of the vault to borrow from
    @param amount The amount of PAR to borrow
   */
  function borrow(uint256 vaultId, uint256 amount) external override {
    core.borrow(vaultId, amount);
  }
}
