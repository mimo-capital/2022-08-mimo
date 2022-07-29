// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IMIMOManagedRebalance.sol";
import "./MIMOManagedAction.sol";
import "../MIMOFlashloan.sol";
import "../../libraries/WadRayMath.sol";

/** 
@title A `SuperVault V2` action contract for configuring a vault to have a manged rebalance. 
@notice This contract only serves to change the access control and enforce the `managedRebalance` configuration; the actual rebalance logic is done through the `MIMORebalance` contract through a `delegateCall` from a `MIMOProxy` clone
*/
contract MIMOManagedRebalance is MIMOManagedAction, MIMOFlashloan, IMIMOManagedRebalance {
  using SafeERC20 for IERC20;
  using WadRayMath for uint256;

  address public immutable mimoRebalance;

  /**
    @param _a The addressProvider for the MIMO protocol
    @param _lendingPool The AAVE lending pool used for flashloans
    @param _proxyRegistry The MIMOProxyRegistry used to verify access control
    @param _mimoRebalance The MIMORebalance contract address that holds the logic for the rebalance call
   */
  constructor(
    IAddressProvider _a,
    IPool _lendingPool,
    IMIMOProxyRegistry _proxyRegistry,
    address _mimoRebalance
  ) MIMOManagedAction(_a, _proxyRegistry) MIMOFlashloan(_lendingPool) {
    if (_mimoRebalance == address(0)) {
      revert CustomErrors.CANNOT_SET_TO_ADDRESS_ZERO();
    }

    mimoRebalance = _mimoRebalance;
  }

  /**
    @notice Perform a rebalance on a vault by an appointed whitelisted manager on behalf of vault owner
    @notice Vault must have been created though a MIMOProxy
    @dev Can only be called once a day by the manager selected by the MIMOProxy owner
    @dev Reverts if operation results in vault value change above allowed variation or in vault ratio lower than min ratio
    @param flData Flashloan data struct containing flashloan parameters
    @param rbData RebalanceData struct containing rebalance operation parameters
    @param swapData SwapData struct containing aggegator swap parameters
   */
  function rebalance(
    FlashLoanData calldata flData,
    IMIMORebalance.RebalanceData calldata rbData,
    IMIMOSwap.SwapData calldata swapData
  ) external override {
    ManagedVault memory managedVault = _managedVaults[rbData.vaultId];
    IVaultsDataProvider vaultsData = a.vaultsData();

    _preRebalanceChecks(managedVault, rbData, vaultsData, flData.amount);

    uint256 managerFee = managedVault.fixedFee + flData.amount.wadMul(managedVault.varFee);
    address vaultOwner = vaultsData.vaultOwner(rbData.vaultId);
    uint256 vaultBId = vaultsData.vaultId(address(rbData.toCollateral), vaultOwner);
    uint256 vaultBBalanceBefore = vaultsData.vaultCollateralBalance(vaultBId);

    _takeFlashLoan(flData, abi.encode(vaultsData.vaultOwner(rbData.vaultId), managerFee, rbData, swapData));

    _postRebalanceChecks(
      managedVault,
      flData.amount,
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
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    (
      address mimoProxy,
      uint256 managerFee,
      IMIMORebalance.RebalanceData memory rbData,
      IMIMOSwap.SwapData memory swapData
    ) = abi.decode(params, (address, uint256, IMIMORebalance.RebalanceData, IMIMOSwap.SwapData));

    if (initiator != address(this)) {
      revert CustomErrors.INITIATOR_NOT_AUTHORIZED(initiator, address(this));
    }
    if (msg.sender != address(lendingPool)) {
      revert CustomErrors.CALLER_NOT_LENDING_POOL(msg.sender, address(lendingPool));
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
    @dev Checks that vault is managed, that rebalance was called by manager, and maximum daily operation was not reached 
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
      revert CustomErrors.MANAGER_NOT_LISTED();
    }
    if (!managedVault.isManaged) {
      revert CustomErrors.VAULT_NOT_UNDER_MANAGEMENT();
    }
    if (msg.sender != managedVault.manager) {
      revert CustomErrors.CALLER_NOT_SELECTED_MANAGER();
    }
    if (rebalanceAmount == 0) {
      revert CustomErrors.REBALANCE_AMOUNT_CANNOT_BE_ZERO();
    }
    if (_operationTracker[rbData.vaultId] > block.timestamp - 1 days) {
      revert CustomErrors.MAX_OPERATIONS_REACHED();
    }
    if (vaultsData.vaultDebt(rbData.vaultId) < rbData.mintAmount) {
      revert CustomErrors.MINT_AMOUNT_GREATER_THAN_VAULT_DEBT();
    }
  }

  /**
    @notice Helper function performing post rebalance operation sanity checks
    @dev Checks that change in global vault value (vault A + B) is below allowedVaration and vault A & B ratios are at least targetRatios
    @param managedVault ManagedVault struct of the vault to rebalance
    @param rebalanceAmount Rebalanced amount
    @param vaultBBalanceBefore Collateral balance of the vault to be rebalanced to before the rebalance operation
    @param vaultId Vault id of the vault to rebalance
    @param vaultOwner Rebalanced vault owner
    @param toCollateral Collateral to rebalance to
    @param vaultsData Cached VaultsDataProvider interface for gas saving
   */
  function _postRebalanceChecks(
    ManagedVault memory managedVault,
    uint256 rebalanceAmount,
    uint256 vaultBBalanceBefore,
    uint256 vaultId,
    address vaultOwner,
    address toCollateral,
    IVaultsDataProvider vaultsData
  ) internal view {
    IPriceFeed priceFeed = a.priceFeed();
    address fromCollateral = vaultsData.vaultCollateralType(vaultId);
    uint256 rebalanceValue = priceFeed.convertFrom(fromCollateral, rebalanceAmount);
    uint256 vaultBId = vaultsData.vaultId(toCollateral, vaultOwner);
    uint256 vaultBBalanceAfter = vaultsData.vaultCollateralBalance(vaultBId);
    uint256 swapResultValue = priceFeed.convertFrom(toCollateral, vaultBBalanceAfter - vaultBBalanceBefore);

    if (!_isVaultVariationAllowed(managedVault, rebalanceValue, swapResultValue)) {
      revert CustomErrors.VAULT_VALUE_CHANGE_TOO_HIGH();
    }

    uint256 vaultARatioAfter = _getVaultRatio(vaultId);

    if (vaultARatioAfter < managedVault.minRatio) {
      revert CustomErrors.FINAL_VAULT_RATIO_TOO_LOW(managedVault.minRatio, vaultARatioAfter);
    }

    uint256 vaultBRatioAfter = _getVaultRatio(vaultBId);
    uint256 minVaultBRatio = a.config().collateralMinCollateralRatio(toCollateral) + managedVault.mcrBuffer;

    if (vaultBRatioAfter < minVaultBRatio) {
      revert CustomErrors.FINAL_VAULT_RATIO_TOO_LOW(minVaultBRatio, vaultBRatioAfter);
    }
  }
}
