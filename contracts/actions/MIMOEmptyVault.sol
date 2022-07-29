// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "../core/interfaces/IVaultsCore.sol";
import "../proxy/interfaces/IMIMOProxy.sol";
import "./interfaces/IMIMOEmptyVault.sol";
import "./MIMOFlashloan.sol";
import "./MIMOSwap.sol";

/**
  @title A SuperVault V2 action contract for repaying an existing vault's debt and withdrawing all collateral without any additional capital.
  @notice Should only be accessed through a MIMOProxy delegateCall
 */
contract MIMOEmptyVault is MIMOSwap, MIMOFlashloan, IMIMOEmtpyVault {
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
    @notice Uses a flashloan to repay all debts for a vault and send all collateral in the vault to the owner
    @notice Vault must have been created though a MIMOProxy
    @dev Should be called by MIMOProxy through a delegatecall 
    @dev Uses an AAVE V3 flashLoan that will call executeOperation
    @param _calldata Bytes containing vaultId, FlashloanData struct, RebalanceData struct, SwapData struct
   */
  function executeAction(bytes calldata _calldata) external override {
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
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    (address owner, uint256 vaultId, SwapData memory swapData) = abi.decode(params, (address, uint256, SwapData));
    IMIMOProxy mimoProxy = IMIMOProxy(proxyRegistry.getCurrentProxy(owner));

    if (initiator != address(mimoProxy)) {
      revert CustomErrors.INITIATOR_NOT_AUTHORIZED(initiator, address(mimoProxy));
    }
    if (msg.sender != address(lendingPool)) {
      revert CustomErrors.CALLER_NOT_LENDING_POOL(msg.sender, address(lendingPool));
    }

    IERC20 vaultCollateral = IERC20(assets[0]);
    uint256 amount = amounts[0];
    vaultCollateral.safeTransfer(address(mimoProxy), amounts[0]);
    uint256 flashloanRepayAmount = amount + premiums[0];

    IMIMOProxy(mimoProxy).execute(
      address(this),
      abi.encodeWithSignature(
        "emptyVaultOperation(address,uint256,uint256,(uint256,bytes))",
        vaultCollateral,
        vaultId,
        amount,
        swapData
      )
    );

    require(flashloanRepayAmount <= vaultCollateral.balanceOf(address(this)), Errors.CANNOT_REPAY_FLASHLOAN);

    vaultCollateral.safeIncreaseAllowance(address(lendingPool), flashloanRepayAmount);

    return true;
  }

  /**
    @notice Used by executeOperation through MIMOProxy callback to perform rebalance logic within MIMOProxy context
    @notice There will likely be some leftover par after repaying the loan; that will also be sent back to the user
    @param vaultCollateral Collateral of the vault to empty
    @param vaultId vault id of the vault to be emptied
    @param swapAmount Amount of collateral to swap to for par to repay vaultdebt
    @param swapData SwapData passed from the flashloan call
   */
  function emptyVaultOperation(
    IERC20 vaultCollateral,
    uint256 vaultId,
    uint256 swapAmount,
    SwapData calldata swapData
  ) external {
    IVaultsCore core = a.core();

    _aggregatorSwap(vaultCollateral, swapAmount, swapData);

    IERC20 stablex = IERC20(a.stablex());
    stablex.safeIncreaseAllowance(address(core), stablex.balanceOf(address(this)));
    core.repayAll(vaultId);

    uint256 withdrawAmount = a.vaultsData().vaultCollateralBalance(vaultId);

    core.withdraw(vaultId, withdrawAmount);
    vaultCollateral.safeTransfer(msg.sender, withdrawAmount);
  }
}
