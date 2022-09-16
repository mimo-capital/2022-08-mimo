// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../core/interfaces/IVaultsCore.sol";
import "../proxy/interfaces/IMIMOProxy.sol";
import "../proxy/interfaces/IMIMOProxyFactory.sol";
import "./interfaces/IMIMOEmptyVault.sol";
import "./MIMOFlashLoan.sol";
import "./MIMOSwap.sol";
import "./MIMOPausable.sol";
import { Errors } from "../libraries/Errors.sol";

contract MIMOEmptyVault is MIMOPausable, MIMOSwap, MIMOFlashLoan, IMIMOEmtpyVault {
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
    @notice Uses a flashloan to repay all debts for a vault and send all collateral in the vault to the owner
    @notice Vault must have been created though a MIMOProxy
    @dev Uses an AAVE V3 flashLoan that will call executeOperation
    @param _calldata Bytes containing vaultId, FlashloanData struct, RebalanceData struct, SwapData struct
   */
  function executeAction(bytes calldata _calldata) external override whenNotPaused {
    (uint256 vaultId, FlashLoanData memory flData, SwapData memory swapData) = abi.decode(
      _calldata,
      (uint256, FlashLoanData, SwapData)
    );
    bytes memory params = abi.encode(msg.sender, vaultId, swapData);

    _takeFlashLoan(flData, params);
  }

  /**
    @notice Executes an emptyVault operation after taking a flashloan
    @dev Integrates with AAVE V3 flashLoans
    @param assets Address array with one element corresponding to the address of the target vault asset
    @param amounts Uint array with one element corresponding to the amount of the target vault asset
    @param premiums Uint array with one element corresponding to the flashLoan fees
    @param initiator Initiator of the flashloan; can only be MIMOProxy owner
    @param params Bytes sent by this contract containing MIMOProxy owner, target vault id, SwapData struct
    @return True if success and False if failed
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override whenNotPaused returns (bool) {
    (address owner, uint256 vaultId, SwapData memory swapData) = abi.decode(params, (address, uint256, SwapData));
    IMIMOProxy mimoProxy = proxyFactory.getCurrentProxy(owner);

    if (initiator != address(mimoProxy)) {
      revert Errors.INITIATOR_NOT_AUTHORIZED(initiator, address(mimoProxy));
    }
    if (msg.sender != address(lendingPool)) {
      revert Errors.CALLER_NOT_LENDING_POOL(msg.sender, address(lendingPool));
    }

    IERC20 vaultCollateral = IERC20(assets[0]);
    uint256 amount = amounts[0];
    vaultCollateral.safeTransfer(address(mimoProxy), amounts[0]);
    uint256 flashloanRepayAmount = amount + premiums[0];

    IMIMOProxy(mimoProxy).execute(
      address(this),
      abi.encodeWithSignature(
        "emptyVaultOperation(address,address,uint256,uint256,uint256,(uint256,bytes))",
        owner,
        vaultCollateral,
        vaultId,
        amount,
        flashloanRepayAmount,
        swapData
      )
    );

    vaultCollateral.safeIncreaseAllowance(address(lendingPool), flashloanRepayAmount);

    return true;
  }

  /**
    @notice Used by executeOperation through MIMOProxy callback to perform rebalance logic within MIMOProxy context
    @notice There will likely be some leftover par after repaying the loan; that will also be sent back to the user
    @param owner Address of the mimoProxy owner 
    @param vaultCollateral Collateral of the vault to empty
    @param vaultId vault id of the vault to be emptied
    @param swapAmount Amount of collateral to swap to for par to repay vaultdebt
    @param flashLoanRepayAmount Amount of collateral to repay to flashloan protocol at the end of the tx 
    @param swapData SwapData passed from the flashloan call
   */
  function emptyVaultOperation(
    address owner,
    IERC20 vaultCollateral,
    uint256 vaultId,
    uint256 swapAmount,
    uint256 flashLoanRepayAmount,
    SwapData calldata swapData
  ) external whenNotPaused {
    IERC20 stablex = IERC20(a.stablex());
    IVaultsCore core = a.core();

    uint256 beforeParBalance = stablex.balanceOf(address(this));
    _aggregatorSwap(vaultCollateral, swapAmount, swapData);

    stablex.safeIncreaseAllowance(address(core), stablex.balanceOf(address(this)));
    core.repayAll(vaultId);

    uint256 withdrawAmount = a.vaultsData().vaultCollateralBalance(vaultId);

    core.withdraw(vaultId, withdrawAmount);

    if (flashLoanRepayAmount > vaultCollateral.balanceOf(address(this))) {
      revert Errors.CANNOT_REPAY_FLASHLOAN();
    }

    // Send flashloanRepayAmount to this contract for loan repayment
    vaultCollateral.safeTransfer(msg.sender, flashLoanRepayAmount);

    // Transfer leftover PAR and collateral from emptying vault to owner
    if (withdrawAmount > flashLoanRepayAmount) {
      // Send any extra asset amount to owner
      vaultCollateral.safeTransfer(owner, withdrawAmount - flashLoanRepayAmount);
    } // else if flashLoanRepayAmount is greater than amount, the transaction might need to use funds from MIMOProxy

    uint256 afterParBalance = stablex.balanceOf(address(this));
    if (afterParBalance > beforeParBalance) {
      stablex.safeTransfer(owner, afterParBalance - beforeParBalance); // Send remaining par from swap to owner
    }
  }
}
