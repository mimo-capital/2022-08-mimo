// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../core/interfaces/IVaultsCore.sol";
import "../../core/interfaces/IVaultsDataProvider.sol";

interface IMIMOVaultActions {
  function deposit(IERC20 collateral, uint256 amount) external;

  function depositETH() external payable;

  function depositAndBorrow(
    IERC20 collateral,
    uint256 depositAmount,
    uint256 borrowAmount
  ) external;

  function depositETHAndBorrow(uint256 borrowAmount) external payable;

  function withdraw(uint256 vaultId, uint256 amount) external;

  function withdrawETH(uint256 vaultId, uint256 amount) external;

  function borrow(uint256 vaultId, uint256 amount) external;

  function core() external returns (IVaultsCore);

  function vaultsData() external returns (IVaultsDataProvider);

  function stablex() external returns (IERC20);
}
