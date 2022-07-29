// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "./MIMOFlashloan.sol";
import "./MIMOSwap.sol";
import "./interfaces/IMIMOLeverage.sol";
import "../core/interfaces/IVaultsCore.sol";
import "../proxy/interfaces/IMIMOProxy.sol";

/**
  @title A SuperVault V2 action contract that can be used to leverage collateral on the MIMO protocol
  @notice Should only be accessed through a MIMOProxy delegateCall
 */
contract MIMOLeverage is MIMOFlashloan, MIMOSwap, IMIMOLeverage {
  using SafeERC20 for IERC20;

  IMIMOProxyRegistry public immutable proxyRegistry;

  /**
    @param _a The addressProvider for the MIMO protocol
    @param _dexAP The dexAddressProvider for the MIMO protocol
    @param _lendingPool The AAVE lending pool used for flashloans
    @param _proxyRegistry The MIMOProxyRegistry used to verify access control
   */
  constructor(
    IAddressProvider _a,
    IDexAddressProvider _dexAP,
    IPool _lendingPool,
    IMIMOProxyRegistry _proxyRegistry
  ) MIMOFlashloan(_lendingPool) MIMOSwap(_a, _dexAP) {
    if (address(_proxyRegistry) == address(0)) {
      revert CustomErrors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    proxyRegistry = _proxyRegistry;
  }

  /**
    @notice Leverage an asset using a flashloan to balance collateral
    @notice Vault must have been created though a MIMOProxy
    @dev Should be called by MIMOProxy through a delegatecall 
    @dev Uses an AAVE V3 flashLoan that will call executeOperation
    @param _calldata Bytes containing depositAmount, stablex swapAmount, struct FlashloanDat data and struc SwapData
   */
  function executeAction(bytes calldata _calldata) external override {
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
    @notice Executes a leverage operation after taking a flashloan 
    @dev Integrates with AAVE V3 flashLoans
    @param assets Address array with one element corresponding to the address of the leveraged asset
    @param amounts Uint array with one element corresponding to the amount of the leveraged asset
    @param premiums Uint array with one element corresponding to the flashLoan fees
    @param initiator Initiator of the flashloan; can only be MIMOProxy owner
    @param params Bytes sent by this contract containing MIMOProxy owner, stablex swap amount and swap data
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    (address owner, uint256 swapAmount, SwapData memory swapData) = abi.decode(params, (address, uint256, SwapData));
    IMIMOProxy mimoProxy = IMIMOProxy(proxyRegistry.getCurrentProxy(owner));

    if (initiator != address(mimoProxy)) {
      revert CustomErrors.INITIATOR_NOT_AUTHORIZED(initiator, address(mimoProxy));
    }
    if (msg.sender != address(lendingPool)) {
      revert CustomErrors.CALLER_NOT_LENDING_POOL(msg.sender, address(lendingPool));
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
  ) external override {
    IVaultsCore core = a.core();
    uint256 collateralBalanceBefore = token.balanceOf(address(this));

    token.safeIncreaseAllowance(address(core), collateralBalanceBefore);
    core.depositAndBorrow(address(token), collateralBalanceBefore, swapAmount);

    IERC20 stablex = IERC20(a.stablex());

    _aggregatorSwap(stablex, swapAmount, swapData);

    uint256 collateralBalanceAfter = token.balanceOf(address(this));

    require(collateralBalanceAfter >= flashloanRepayAmount, Errors.CANNOT_REPAY_FLASHLOAN);

    if (collateralBalanceAfter > flashloanRepayAmount) {
      token.safeIncreaseAllowance(address(core), collateralBalanceAfter - flashloanRepayAmount);
      core.deposit(address(token), collateralBalanceAfter - flashloanRepayAmount);
    }

    token.safeTransfer(msg.sender, flashloanRepayAmount);
  }
}
