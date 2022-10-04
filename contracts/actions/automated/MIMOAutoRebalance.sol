// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@aave/core-v3/contracts/protocol/libraries/math/WadRayMath.sol";

import "./MIMOAutoAction.sol";
import "./interfaces/IMIMOAutoRebalance.sol";
import "../MIMOFlashLoan.sol";
import "../MIMOPausable.sol";
import "../interfaces/IMIMORebalance.sol";
import { Errors } from "../../libraries/Errors.sol";

/**
  Rebalance value is calculated by the formula below :

                     targetRatio * (vaultDebt + fixedFee) - collateralValue
-----------------------------------------------------------------------------------------------------
        targetRatio - (mcrb + mcrBuffer) * premium
     ----------------------------------------------------  - targetRatio * varFee    -  WAD
               (mcrB + mcrBuffer) 
 */

contract MIMOAutoRebalance is MIMOPausable, MIMOAutoAction, MIMOFlashLoan, ReentrancyGuard, IMIMOAutoRebalance {
  using SafeERC20 for IERC20;
  using WadRayMath for uint256;

  uint256 public constant ROUNDING_BUFFER = 1e15; // Padding for difference between accumulated debt since refresh
  uint256 public constant FLASHLOAN_PERCENTAGE_FACTOR = 1e4; // The divisor needed to convert the flashloan fee int into a ratio

  address public immutable mimoRebalance;

  constructor(
    IAddressProvider _a,
    IPool _lendingPool,
    IMIMOProxyFactory _proxyFactory,
    address _mimoRebalance
  ) MIMOAutoAction(_a, _proxyFactory) MIMOFlashLoan(_lendingPool) {
    if (_mimoRebalance == address(0)) {
      revert Errors.CANNOT_SET_TO_ADDRESS_ZERO();
    }
    mimoRebalance = _mimoRebalance;
  }

  /**
    @notice Perform a rebalance on a vault on behalf of vault owner
    @notice Vault must have been created though a MIMOProxy
    @dev Reverts if operation results in vault value change above allowed variation or in vault ratio lower than min 
    ratio
    @param vaultId Vault id of the vault to rebalance
    @param swapData SwapData struct containing aggegator swap parameters
   */
  function rebalance(uint256 vaultId, IMIMOSwap.SwapData calldata swapData)
    external
    override
    whenNotPaused
    nonReentrant
  {
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
    @return True if success and False if failed
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
    @notice Helper function calculating the amount to rebalance from vault A and to mint from vault B with rebalnce 
    formula
    @param autoVault AutomatedVault struct of the vault to rebalance
    @param vaultState VaultState struct of the vault to rebalance
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
    uint256 targetRatio = autoVault.targetRatio + ROUNDING_BUFFER; // Add padding to account for parDebt accumulated since last refresh;
    uint256 toVaultTargetMcr = _a.config().collateralMinCollateralRatio(address(toCollateral)) + autoVault.mcrBuffer;
    uint256 premiumInt = lendingPool.FLASHLOAN_PREMIUM_TOTAL(); // Get premium from lendingPool, in Int
    uint256 premium = (premiumInt * WadRayMath.WAD) / FLASHLOAN_PERCENTAGE_FACTOR; // Convert premium Int into WAD units
    uint256 rebalanceValue = (targetRatio.wadMul(vaultState.vaultDebt + autoVault.fixedFee) -
      vaultState.collateralValue).wadDiv(
        (targetRatio - toVaultTargetMcr.wadMul(premium)).wadDiv(toVaultTargetMcr) -
          targetRatio.wadMul(autoVault.varFee) -
          WadRayMath.WAD
      );
    autoFee = autoVault.fixedFee + rebalanceValue.wadMul(autoVault.varFee);
    rebalanceAmount = _a.priceFeed().convertTo(vaultState.collateralType, rebalanceValue);
    mintAmount = rebalanceValue.wadDiv(toVaultTargetMcr);
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
    @dev Checks that :
      - Vault is automated
      - Maximum daily operations has not been exceeded
      - Vault is below the trigger ratio
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
      revert Errors.VAULT_NOT_AUTOMATED();
    }
    if (_operationTracker[vaultId] > block.timestamp - 1 days) {
      revert Errors.MAX_OPERATIONS_REACHED();
    }
    if (vaultARatio > autoVault.triggerRatio) {
      revert Errors.VAULT_TRIGGER_RATIO_NOT_REACHED(vaultARatio, autoVault.triggerRatio);
    }
  }

  /**
    @notice Helper function performing post rebalance operation sanity checks
    @dev Checks that :
     - Rebalance swap slippage is below allowedVaration
     - Vault ratio is above targetRatio
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
      revert Errors.VAULT_VALUE_CHANGE_TOO_HIGH();
    }

    (uint256 vaultARatio, ) = _getVaultStats(vaultId);

    if (vaultARatio < autoVault.targetRatio) {
      revert Errors.FINAL_VAULT_RATIO_TOO_LOW(autoVault.targetRatio, vaultARatio);
    }
  }
}
