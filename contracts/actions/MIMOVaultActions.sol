// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./MIMOPausable.sol";
import "./interfaces/IMIMOVaultActions.sol";
import { Errors } from "../libraries/Errors.sol";
import "../core/interfaces/IVaultsCore.sol";
import "../core/interfaces/IVaultsDataProvider.sol";
import "../proxy/interfaces/IMIMOProxyFactory.sol";

contract MIMOVaultActions is MIMOPausable, IMIMOVaultActions {
  using SafeERC20 for IERC20;

  address public immutable override contractAddress;

  IVaultsCore public immutable override core;
  IVaultsDataProvider public immutable override vaultsData;
  IERC20 public immutable override stablex;
  IMIMOProxyFactory public immutable override proxyFactory;

  modifier whenNotPaused() override {
    if (MIMOPausable(contractAddress).paused()) {
      revert Errors.PAUSED();
    }
    _;
  }

  constructor(
    IVaultsCore _core,
    IVaultsDataProvider _vaultsData,
    IERC20 _stablex,
    IMIMOProxyFactory _proxyFactory
  ) {
    if (
      address(_core) == address(0) ||
      address(_vaultsData) == address(0) ||
      address(_stablex) == address(0) ||
      address(_proxyFactory) == address(0)
    ) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    core = _core;
    vaultsData = _vaultsData;
    stablex = _stablex;
    proxyFactory = _proxyFactory;
    contractAddress = address(this);
  }

  function deposit(IERC20 collateral, uint256 amount) external override whenNotPaused {
    collateral.safeTransferFrom(msg.sender, address(this), amount);
    collateral.safeIncreaseAllowance(address(core), amount);
    core.deposit(address(collateral), amount);
  }

  function depositETH() external payable override whenNotPaused {
    core.depositETH{ value: msg.value }();
  }

  function depositAndBorrow(
    IERC20 collateral,
    uint256 depositAmount,
    uint256 borrowAmount
  ) external override whenNotPaused {
    IVaultsCore core_ = core;
    collateral.safeTransferFrom(msg.sender, address(this), depositAmount);
    collateral.safeIncreaseAllowance(address(core_), depositAmount);
    core_.depositAndBorrow(address(collateral), depositAmount, borrowAmount);
    stablex.safeTransfer(proxyFactory.getProxyState(address(this)).owner, borrowAmount);
  }

  function depositETHAndBorrow(uint256 borrowAmount) external payable override whenNotPaused {
    core.depositETHAndBorrow{ value: msg.value }(borrowAmount);
    stablex.safeTransfer(proxyFactory.getProxyState(address(this)).owner, borrowAmount);
  }

  function withdraw(uint256 vaultId, uint256 amount) external override whenNotPaused {
    core.withdraw(vaultId, amount);
    IERC20(vaultsData.vaultCollateralType(vaultId)).safeTransfer(
      proxyFactory.getProxyState(address(this)).owner,
      amount
    );
  }

  function withdrawETH(uint256 vaultId, uint256 amount) external override whenNotPaused {
    core.withdrawETH(vaultId, amount);
    (bool success, bytes memory response) = proxyFactory.getProxyState(address(this)).owner.call{ value: amount }("");
    if (!success) {
      if (response.length > 0) {
        assembly {
          let returndata_size := mload(response)
          revert(add(32, response), returndata_size)
        }
      } else {
        revert Errors.EXECUTION_REVERTED();
      }
    }
  }

  function borrow(uint256 vaultId, uint256 amount) external override whenNotPaused {
    core.borrow(vaultId, amount);
    stablex.safeTransfer(proxyFactory.getProxyState(address(this)).owner, amount);
  }
}
