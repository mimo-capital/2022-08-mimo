// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IMIMOAutoRebalance.sol";
import "../interfaces/IMIMORebalance.sol";
import "./MIMOAutoAction.sol";
import "../MIMOFlashloan.sol";
import "../../libraries/WadRayMath.sol";

/**
  Rebalance value is calculated by the formula below :

        targetRatio * (vaultDebt + fixedFee) - collateralValue
      ----------------------------------------------------------
          targetRatio / mcrB - 1 - targetRatio * variableFee 
 */

/// @title A `SuperVault V2` action contract for configuring a vault to be autorebalanced.
/// @notice This allows anyone to rebalance the vault, as long as the rebalance meets the `autoRebalance` configuration.
contract MIMOAutoRebalance is MIMOAutoAction, MIMOFlashloan, IMIMOAutoRebalance {
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
  ) MIMOAutoAction(_a, _proxyRegistry) MIMOFlashloan(_lendingPool) {
    if (_mimoRebalance == address(0)) {
      revert CustomErrors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    mimoRebalance = _mimoRebalance;
  }

  /**
    @notice Perform a rebalance on a vault on behalf of vault owner
    @notice Vault must have been created though a MIMOProxy
    @dev Reverts if operation results in vault value change above allowed variation or in vault ratio lower than min ratio
    @param vaultId Vault id of the vault to rebalance
    @param swapData SwapData struct containing aggegator swap parameters
   */
  function rebalance(uint256 vaultId, IMIMOSwap.SwapData calldata swapData) external override {
    AutomatedVault memory autoVault = _automatedVaults[vaultId];

    (uint256 vaultARatioBefore, VaultState memory vaultAState) = _getVaultStats(vaultId);

    _preRebalanceChecks(autoVault, vaultId, vaultARatioBefore);

    IVaultsDataProvider vaultsData = a.vaultsData();
    address vaultOwner = vaultsData.vaultOwner(vaultId);
    uint256 vaultBId = vaultsData.vaultId(address(autoVault.toCollateral), vaultOwner);
    uint256 vaultBBalanceBefore = vaultsData.vaultCollateralBalance(vaultBId);

    (IMIMORebalance.RebalanceData memory rbData, FlashLoanData memory flData, uint256 autoFee) = _getRebalanceParams(
      autoVault,
      vaultAState,
      IERC20(autoVault.toCollateral),
      vaultId
    );

    _takeFlashLoan(flData, abi.encode(vaultOwner, autoFee, rbData, swapData));
    _postRebalanceChecks(autoVault, flData.amount, vaultBBalanceBefore, vaultId, vaultOwner, vaultsData);

    _operationTracker[vaultId] = block.timestamp;

    IERC20(a.stablex()).safeTransfer(msg.sender, autoFee);
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
    @notice Getter function returning rebalance amounts for specific vault id
    @param vaultId Vault id of the vault to rebalance
    @param toCollateral Collateral to rebalance to
    @return rebalanceAmount Amount to rebalance
    @return mintAmount Amount to mint on vault B
    @return autoFee Automation fee
   */
  function getAmounts(uint256 vaultId, address toCollateral)
    external
    view
    override
    returns (
      uint256 rebalanceAmount,
      uint256 mintAmount,
      uint256 autoFee
    )
  {
    (, VaultState memory vaultState) = _getVaultStats(vaultId);
    return _getAmounts(_automatedVaults[vaultId], vaultState, toCollateral);
  }

  /**
    @notice Helper function calculating the amount to rebalance from vault A and to mint from vault B with rebalnce formula
    @param autoVault AutomatedVault struct of the vault to rebalance
    @param vaultState VaultState struct og the vault to rebalance
    @param toCollateral Collateral to rebalance to
    @return rebalanceAmount Amount to rebalance
    @return mintAmount Amount to mint on vault b
    @return autoFee Automation fee
   */
  function _getAmounts(
    AutomatedVault memory autoVault,
    VaultState memory vaultState,
    address toCollateral
  )
    internal
    view
    returns (
      uint256 rebalanceAmount,
      uint256 mintAmount,
      uint256 autoFee
    )
  {
    IAddressProvider _a = a;

    uint256 targetRatio = autoVault.targetRatio + 1e15; // add 0.1% to account for rounding
    uint256 toVaultMcr = _a.config().collateralMinCollateralRatio(address(toCollateral));

    // The rebalanceValue is the PAR value of the amount of collateral we need to rebalance
    uint256 rebalanceValue = (targetRatio.wadMul(vaultState.vaultDebt + autoVault.fixedFee) -
      vaultState.collateralValue).wadDiv(
        (targetRatio.wadDiv(toVaultMcr + autoVault.mcrBuffer) - targetRatio.wadMul(autoVault.varFee) - WadRayMath.WAD)
      );

    autoFee = autoVault.fixedFee + rebalanceValue.wadMul(autoVault.varFee);
    rebalanceAmount = _a.priceFeed().convertTo(vaultState.collateralType, rebalanceValue);
    mintAmount = rebalanceValue.wadDiv(toVaultMcr + autoVault.mcrBuffer) - autoFee;
  }

  /**
    @notice Helper function formatting FlashloanData and RebalanceData parameters
    @param autoVault AutomatedVault struct of the vault to rebalance
    @param vaultState VaultState struct of the vault to rebalance
    @param toCollateral Collateral to rebalance to
    @param vaultId Vault id of the vault to rebalance
    @return rbData RebalanceData struct
    @return flData FlashloanData struct
    @return autoFee Automation fee
   */
  function _getRebalanceParams(
    AutomatedVault memory autoVault,
    VaultState memory vaultState,
    IERC20 toCollateral,
    uint256 vaultId
  )
    internal
    view
    returns (
      IMIMORebalance.RebalanceData memory rbData,
      FlashLoanData memory flData,
      uint256 autoFee
    )
  {
    (uint256 rebalanceAmount, uint256 mintAmount, uint256 _autoFee) = _getAmounts(
      autoVault,
      vaultState,
      address(toCollateral)
    );

    autoFee = _autoFee;
    rbData = IMIMORebalance.RebalanceData({ toCollateral: toCollateral, vaultId: vaultId, mintAmount: mintAmount });
    flData = FlashLoanData({ asset: vaultState.collateralType, proxyAction: address(this), amount: rebalanceAmount });
  }

  /**
    @notice Helper function performing pre rebalance operation sanity checks
    @dev Checks that vault is automated, that maximum daily operation was not reached and that trigger ratio was reached
    @param autoVault AutomatedVault struct of the vault to rebalance
    @param vaultId Vault id of the vault to rebalance
    @param vaultARatio Collateral to debt ratio of the vault to rebalance
   */
  function _preRebalanceChecks(
    AutomatedVault memory autoVault,
    uint256 vaultId,
    uint256 vaultARatio
  ) internal view {
    if (!autoVault.isAutomated) {
      revert CustomErrors.VAULT_NOT_AUTOMATED();
    }
    if (_operationTracker[vaultId] > block.timestamp - 1 days) {
      revert CustomErrors.MAX_OPERATIONS_REACHED();
    }
    if (vaultARatio > autoVault.triggerRatio) {
      revert CustomErrors.VAULT_TRIGGER_RATIO_NOT_REACHED(vaultARatio, autoVault.triggerRatio);
    }
  }

  /**
    @notice Helper function performing post rebalance operation sanity checks
    @dev Checks that change in global vault value (vault A + B) is below allowedVaration and vault A ratio equal or above targetRatio
    @param autoVault AutomatedVault struct of the vault to rebalance
    @param rebalanceAmount Rebalanced amount
    @param vaultBBalanceBefore Collateral balance of the vault to be rebalanced to before the rebalance operation
    @param vaultId Vault id of the vault to rebalance
    @param vaultOwner Rebalanced vault owner
    @param vaultsData Cached VaultsDataProvider interface for gas saving
   */
  function _postRebalanceChecks(
    AutomatedVault memory autoVault,
    uint256 rebalanceAmount,
    uint256 vaultBBalanceBefore,
    uint256 vaultId,
    address vaultOwner,
    IVaultsDataProvider vaultsData
  ) internal view {
    IPriceFeed priceFeed = a.priceFeed();
    address fromCollateral = vaultsData.vaultCollateralType(vaultId);
    uint256 rebalanceValue = priceFeed.convertFrom(fromCollateral, rebalanceAmount);
    uint256 vaultBId = vaultsData.vaultId(autoVault.toCollateral, vaultOwner);
    uint256 vaultBBalanceAfter = vaultsData.vaultCollateralBalance(vaultBId);
    uint256 swapResultValue = priceFeed.convertFrom(autoVault.toCollateral, vaultBBalanceAfter - vaultBBalanceBefore);

    if (!_isVaultVariationAllowed(autoVault, rebalanceValue, swapResultValue)) {
      revert CustomErrors.VAULT_VALUE_CHANGE_TOO_HIGH();
    }

    (uint256 vaultARatio, ) = _getVaultStats(vaultId);

    if (vaultARatio < autoVault.targetRatio) {
      revert CustomErrors.FINAL_VAULT_RATIO_TOO_LOW(autoVault.targetRatio, vaultARatio);
    }
  }
}
