// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@aave/core-v3/contracts/protocol/libraries/math/WadRayMath.sol";

import "./MIMOManagedAction.sol";
import "./interfaces/IMIMOManagedRebalance.sol";
import "../MIMOPausable.sol";
import "../MIMOFlashLoan.sol";

contract MIMOManagedRebalance is
  MIMOPausable,
  MIMOManagedAction,
  MIMOFlashLoan,
  ReentrancyGuard,
  IMIMOManagedRebalance
{
  using SafeERC20 for IERC20;
  using WadRayMath for uint256;

  address public immutable mimoRebalance;

  constructor(
    IAddressProvider _a,
    IPool _lendingPool,
    IMIMOProxyFactory _proxyFactory,
    address _mimoRebalance
  ) MIMOManagedAction(_a, _proxyFactory) MIMOFlashLoan(_lendingPool) {
    if (_mimoRebalance == address(0)) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }

    mimoRebalance = _mimoRebalance;
  }

  /**
    @notice Perform a rebalance on a vault by an appointed whitelisted manager on behalf of vault owner
    @notice Vault must have been created though a MIMOProxy
    @dev Can only be called once a day by the manager selected by the MIMOProxy owner
    @dev Reverts if operation results in vault value change above allowed variation or in vault ratio lower 
    than min ratio
    @dev NonReentrant to avoid exploits on what happens between before and after rebalance checks
    @param flData Flashloan data struct containing flashloan parameters
    @param rbData RebalanceData struct containing rebalance operation parameters
    @param swapData SwapData struct containing aggegator swap parameters
   */
  function rebalance(
    FlashLoanData calldata flData,
    IMIMORebalance.RebalanceData calldata rbData,
    IMIMOSwap.SwapData calldata swapData
  ) external override whenNotPaused nonReentrant {
    ManagedVault memory managedVault = _managedVaults[rbData.vaultId];
    IVaultsDataProvider vaultsData = a.vaultsData();

    _preRebalanceChecks(managedVault, rbData, vaultsData, flData.amount);

    // Value of the flashloaned collateral is the same as the value of the rebalanced collateral
    address fromCollateral = vaultsData.vaultCollateralType(rbData.vaultId);
    uint256 rebalanceValue = a.priceFeed().convertFrom(fromCollateral, flData.amount);
    uint256 managerFee = managedVault.fixedFee + rebalanceValue.wadMul(managedVault.varFee);
    address vaultOwner = vaultsData.vaultOwner(rbData.vaultId);
    uint256 vaultBId = vaultsData.vaultId(address(rbData.toCollateral), vaultOwner);
    uint256 vaultBBalanceBefore = vaultsData.vaultCollateralBalance(vaultBId);

    _takeFlashLoan(flData, abi.encode(vaultsData.vaultOwner(rbData.vaultId), managerFee, rbData, swapData));

    _postRebalanceChecks(
      managedVault,
      rebalanceValue,
      vaultBBalanceBefore,
      rbData.vaultId,
      vaultOwner,
      address(rbData.toCollateral),
      vaultsData
    );

    _operationTracker[rbData.vaultId] = block.timestamp;

    IERC20(a.stablex()).safeTransfer(managedVault.manager, managerFee);
  }

  /**
    @notice Routes a call from a flashloan pool to a leverage or rebalance operation
    @dev Integrates with AAVE V3 flashLoans
    @param assets Address array with one element corresponding to the address of the reblanced asset
    @param amounts Uint array with one element corresponding to the amount of the rebalanced asset
    @param premiums Uint array with one element corresponding to the flashLoan fees
    @param initiator Initiator of the flashloan; can only be MIMOProxy owner
    @param params Bytes sent by this contract containing MIMOProxy owner, RebalanceData struct and SwapData struct
    @return True if success and False if not
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override whenNotPaused returns (bool) {
    (
      address mimoProxy,
      uint256 managerFee,
      IMIMORebalance.RebalanceData memory rbData,
      IMIMOSwap.SwapData memory swapData
    ) = abi.decode(params, (address, uint256, IMIMORebalance.RebalanceData, IMIMOSwap.SwapData));

    if (initiator != address(this)) {
      revert Errors.INITIATOR_NOT_AUTHORIZED(initiator, address(this));
    }
    if (msg.sender != address(lendingPool)) {
      revert Errors.CALLER_NOT_LENDING_POOL(msg.sender, address(lendingPool));
    }

    IERC20 fromCollateral = IERC20(assets[0]);
    uint256 amount = amounts[0];
    fromCollateral.safeTransfer(address(mimoProxy), amounts[0]);
    uint256 flashloanRepayAmount = amounts[0] + premiums[0];

    IMIMOProxy(mimoProxy).execute(
      mimoRebalance,
      abi.encodeWithSignature(
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))",
        fromCollateral,
        amount,
        flashloanRepayAmount,
        managerFee,
        rbData,
        swapData
      )
    );

    fromCollateral.safeIncreaseAllowance(address(lendingPool), flashloanRepayAmount);

    return true;
  }

  /**
    @notice Helper function performing pre rebalance operation sanity checks
    @dev Checks that :
      - Manager is whitelisted
      - Vault is under management
      - Caller is the vault selected manager
      - Rebalance amount is greater than zero
      - Maximum daily operations has not been exceeded
      - Mint amount is not greater than vault debt
    @param managedVault ManagedVault struct of the vault to rebalance
    @param rbData RebalanceData struct of the vault to rebalance
    @param vaultsData Cached VaultsDataProvider interface for gas saving
   */
  function _preRebalanceChecks(
    ManagedVault memory managedVault,
    IMIMORebalance.RebalanceData calldata rbData,
    IVaultsDataProvider vaultsData,
    uint256 rebalanceAmount
  ) internal view {
    if (!_managers[msg.sender]) {
      revert Errors.MANAGER_NOT_LISTED();
    }
    if (!managedVault.isManaged) {
      revert Errors.VAULT_NOT_UNDER_MANAGEMENT();
    }
    if (msg.sender != managedVault.manager) {
      revert Errors.CALLER_NOT_SELECTED_MANAGER();
    }
    if (rebalanceAmount == 0) {
      revert Errors.REBALANCE_AMOUNT_CANNOT_BE_ZERO();
    }
    if (_operationTracker[rbData.vaultId] > block.timestamp - 1 days) {
      revert Errors.MAX_OPERATIONS_REACHED();
    }
    if (vaultsData.vaultDebt(rbData.vaultId) < rbData.mintAmount) {
      revert Errors.MINT_AMOUNT_GREATER_THAN_VAULT_DEBT();
    }
  }

  /**
    @notice Helper function performing post rebalance operation sanity checks
    @dev Checks that :
      - Rebalance swap slippage is below allowedVaration
      - Vault A ratio is equal or above minRatio
      - Vault B ratio is equal or above MCR + mcrBuffer
    @param managedVault ManagedVault struct of the vault to rebalance
    @param rebalanceValue Value in PAR of the amount of rebalanced collateral 
    @param vaultBBalanceBefore Collateral balance of the vault to be rebalanced to before the rebalance operation
    @param vaultId Vault id of the vault to rebalance
    @param vaultOwner Rebalanced vault owner
    @param toCollateral Collateral to rebalance to
    @param vaultsData Cached VaultsDataProvider interface for gas saving
   */
  function _postRebalanceChecks(
    ManagedVault memory managedVault,
    uint256 rebalanceValue,
    uint256 vaultBBalanceBefore,
    uint256 vaultId,
    address vaultOwner,
    address toCollateral,
    IVaultsDataProvider vaultsData
  ) internal view {
    IPriceFeed priceFeed = a.priceFeed();
    uint256 vaultBId = vaultsData.vaultId(toCollateral, vaultOwner);
    uint256 vaultBBalanceAfter = vaultsData.vaultCollateralBalance(vaultBId);
    uint256 swapResultValue = priceFeed.convertFrom(toCollateral, vaultBBalanceAfter - vaultBBalanceBefore);

    if (!_isVaultVariationAllowed(managedVault, rebalanceValue, swapResultValue)) {
      revert Errors.VAULT_VALUE_CHANGE_TOO_HIGH();
    }

    uint256 vaultARatioAfter = _getVaultRatio(vaultId);

    if (vaultARatioAfter < managedVault.minRatio) {
      revert Errors.FINAL_VAULT_RATIO_TOO_LOW(managedVault.minRatio, vaultARatioAfter);
    }

    uint256 vaultBRatioAfter = _getVaultRatio(vaultBId);
    uint256 minVaultBRatio = a.config().collateralMinCollateralRatio(toCollateral) + managedVault.mcrBuffer;

    if (vaultBRatioAfter < minVaultBRatio) {
      revert Errors.FINAL_VAULT_RATIO_TOO_LOW(minVaultBRatio, vaultBRatioAfter);
    }
  }
}
