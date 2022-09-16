// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "./MIMOFlashLoan.sol";
import "./MIMOSwap.sol";
import "./MIMOPausable.sol";
import "./interfaces/IMIMOLeverage.sol";
import "../core/interfaces/IVaultsCore.sol";
import "../proxy/interfaces/IMIMOProxy.sol";
import "../proxy/interfaces/IMIMOProxyFactory.sol";
import { Errors } from "../libraries/Errors.sol";

contract MIMOLeverage is MIMOPausable, MIMOFlashLoan, MIMOSwap, IMIMOLeverage {
  using SafeERC20 for IERC20;

  /// @notice storing address(this) as an immutable variable to be able to access it within delegatecall
  address private immutable _contractAddress;
  IMIMOProxyFactory public immutable override proxyFactory;

  modifier whenNotPaused() override {
    if (MIMOPausable(_contractAddress).paused()) {
      revert Errors.PAUSED();
    }
    _;
  }

  constructor(
    IAddressProvider _a,
    IDexAddressProvider _dexAP,
    IPool _lendingPool,
    IMIMOProxyFactory _proxyFactory
  ) MIMOFlashLoan(_lendingPool) MIMOSwap(_a, _dexAP) {
    if (address(_proxyFactory) == address(0)) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    proxyFactory = _proxyFactory;
    _contractAddress = address(this);
  }

  /**
    @notice Leverage an asset using a flashloan to balance collateral
    @notice Vault must have been created though a MIMOProxy
    @dev Uses an AAVE V3 flashLoan that will call executeOperation
    @param _calldata Bytes containing depositAmount, stablex swapAmount, struct FlashloanDat data and struc SwapData
   */
  function executeAction(bytes calldata _calldata) external override whenNotPaused {
    (uint256 depositAmount, uint256 swapAmount, FlashLoanData memory flData, SwapData memory swapData) = abi.decode(
      _calldata,
      (uint256, uint256, FlashLoanData, SwapData)
    );

    if (depositAmount > 0) {
      IERC20(flData.asset).safeTransferFrom(msg.sender, address(this), depositAmount);
    }

    bytes memory params = abi.encode(msg.sender, swapAmount, swapData);

    _takeFlashLoan(flData, params);
  }

  /**
    @notice Executes an leverage operation after taking a flashloan
    @dev Integrates with AAVE V3 flashLoans
    @param assets Address array with one element corresponding to the address of the leveraged asset
    @param amounts Uint array with one element corresponding to the amount of the leveraged asset
    @param premiums Uint array with one element corresponding to the flashLoan fees
    @param initiator Initiator of the flashloan; can only be MIMOProxy owner
    @param params Bytes sent by this contract containing MIMOProxy owner, stablex swap amount and swap data
    @return True if success and False if failed
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override whenNotPaused returns (bool) {
    (address owner, uint256 swapAmount, SwapData memory swapData) = abi.decode(params, (address, uint256, SwapData));
    IMIMOProxy mimoProxy = proxyFactory.getCurrentProxy(owner);

    if (initiator != address(mimoProxy)) {
      revert Errors.INITIATOR_NOT_AUTHORIZED(initiator, address(mimoProxy));
    }
    if (msg.sender != address(lendingPool)) {
      revert Errors.CALLER_NOT_LENDING_POOL(msg.sender, address(lendingPool));
    }

    IERC20 asset = IERC20(assets[0]);
    asset.safeTransfer(address(mimoProxy), amounts[0]);
    uint256 flashloanRepayAmount = amounts[0] + premiums[0];

    IMIMOProxy(mimoProxy).execute(
      address(this),
      abi.encodeWithSignature(
        "leverageOperation(address,uint256,uint256,(uint256,bytes))",
        asset,
        swapAmount,
        flashloanRepayAmount,
        swapData
      )
    );

    asset.safeIncreaseAllowance(address(lendingPool), flashloanRepayAmount);

    return true;
  }

  /**
    @notice Used by executeOperation through MIMOProxy callback to perform leverage logic within MIMOProxy context
    @param token ERC20 token to leverage
    @param swapAmount Stablex swap amount
    @param flashloanRepayAmount Amount to be repaid for the flashloan
    @param swapData SwapData passed from the flashloan call
   */
  function leverageOperation(
    IERC20 token,
    uint256 swapAmount,
    uint256 flashloanRepayAmount,
    SwapData calldata swapData
  ) external override whenNotPaused {
    IVaultsCore core = a.core();
    uint256 collateralBalanceBefore = token.balanceOf(address(this));

    token.safeIncreaseAllowance(address(core), collateralBalanceBefore);
    core.depositAndBorrow(address(token), collateralBalanceBefore, swapAmount);

    IERC20 stablex = IERC20(a.stablex());

    _aggregatorSwap(stablex, swapAmount, swapData);

    uint256 collateralBalanceAfter = token.balanceOf(address(this));

    if (flashloanRepayAmount > collateralBalanceAfter) {
      revert Errors.CANNOT_REPAY_FLASHLOAN();
    }

    if (collateralBalanceAfter > flashloanRepayAmount) {
      token.safeIncreaseAllowance(address(core), collateralBalanceAfter - flashloanRepayAmount);
      core.deposit(address(token), collateralBalanceAfter - flashloanRepayAmount);
    }

    token.safeTransfer(msg.sender, flashloanRepayAmount);
  }
}
