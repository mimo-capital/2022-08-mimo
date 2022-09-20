// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "./MIMOFlashLoan.sol";
import "./MIMOSwap.sol";
import "./MIMOPausable.sol";
import "./interfaces/IMIMORebalance.sol";
import "../core/interfaces/IVaultsCore.sol";
import "../proxy/interfaces/IMIMOProxy.sol";
import "../proxy/interfaces/IMIMOProxyFactory.sol";
import { Errors } from "../libraries/Errors.sol";

contract MIMORebalance is MIMOPausable, MIMOFlashLoan, MIMOSwap, IMIMORebalance {
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
    @notice Uses a flashloan to exchange one collateral type for another, e.g. to hold less volatile collateral
    @notice Vault must have been created though a MIMOProxy
    @dev Uses an AAVE V3 flashLoan that will call executeOperation
    @param _calldata Bytes containing FlashloanData struct, RebalanceData struct, SwapData struct
   */
  function executeAction(bytes calldata _calldata) external override whenNotPaused {
    (FlashLoanData memory flData, RebalanceData memory rbData, SwapData memory swapData) = abi.decode(
      _calldata,
      (FlashLoanData, RebalanceData, SwapData)
    );
    bytes memory params = abi.encode(msg.sender, rbData, swapData);
    _takeFlashLoan(flData, params);
  }

  /**
    @notice Executes an rebalance operation after taking a flashloan
    @dev Integrates with AAVE V3 flashLoans
    @param assets Address array with one element corresponding to the address of the reblanced asset
    @param amounts Uint array with one element corresponding to the amount of the rebalanced asset
    @param premiums Uint array with one element corresponding to the flashLoan fees
    @param initiator Initiator of the flashloan; can only be MIMOProxy owner
    @param params Bytes sent by this contract containing MIMOProxy owner, RebalanceData struct and SwapData struct
    @return True if success and False if failed
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override whenNotPaused returns (bool) {
    (address owner, RebalanceData memory rbData, SwapData memory swapData) = abi.decode(
      params,
      (address, RebalanceData, SwapData)
    );
    IMIMOProxy mimoProxy = proxyFactory.getCurrentProxy(owner);

    if (initiator != address(mimoProxy)) {
      revert Errors.INITIATOR_NOT_AUTHORIZED(initiator, address(mimoProxy));
    }
    if (msg.sender != address(lendingPool)) {
      revert Errors.CALLER_NOT_LENDING_POOL(msg.sender, address(lendingPool));
    }

    IERC20 fromCollateral = IERC20(assets[0]);
    uint256 amount = amounts[0];
    fromCollateral.safeTransfer(address(mimoProxy), amounts[0]);
    uint256 flashloanRepayAmount = amount + premiums[0];

    IMIMOProxy(mimoProxy).execute(
      address(this),
      abi.encodeWithSignature(
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))",
        fromCollateral,
        amount,
        flashloanRepayAmount,
        0,
        rbData,
        swapData
      )
    );

    fromCollateral.safeIncreaseAllowance(address(lendingPool), flashloanRepayAmount);

    return true;
  }

  /**
    @notice Used by executeOperation through MIMOProxy callback to perform rebalance logic within MIMOProxy context
    @param fromCollateral The ERC20 token to rebalance from
    @param swapAmount The amount of collateral to swap to for par to repay vaultdebt
    @param flashloanRepayAmount The amount that needs to be repaid for the flashloan
    @param fee Optional fee to be passed in the context of a ManagedRebalance to mint additional stablex to pay manager
    @param rbData RebalanceData passed from the flashloan call
    @param swapData SwapData passed from the flashloan call
   */
  function rebalanceOperation(
    IERC20 fromCollateral,
    uint256 swapAmount,
    uint256 flashloanRepayAmount,
    uint256 fee,
    RebalanceData calldata rbData,
    SwapData calldata swapData
  ) external override whenNotPaused {
    IVaultsCore core = a.core();
    _aggregatorSwap(fromCollateral, swapAmount, swapData);
    uint256 depositAmount = rbData.toCollateral.balanceOf(address(this));
    rbData.toCollateral.safeIncreaseAllowance(address(core), depositAmount);
    core.depositAndBorrow(address(rbData.toCollateral), depositAmount, rbData.mintAmount);
    core.repay(rbData.vaultId, rbData.mintAmount - fee);

    if (flashloanRepayAmount > a.vaultsData().vaultCollateralBalance(rbData.vaultId)) {
      revert Errors.CANNOT_REPAY_FLASHLOAN();
    }

    core.withdraw(rbData.vaultId, flashloanRepayAmount);
    fromCollateral.safeTransfer(msg.sender, flashloanRepayAmount);
    if (fee > 0) {
      IERC20(a.stablex()).safeTransfer(msg.sender, fee);
    }
  }
}
