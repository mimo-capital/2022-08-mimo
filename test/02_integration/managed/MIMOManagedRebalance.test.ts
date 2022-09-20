import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers, network } from "hardhat";
import { ADDRESSES } from "../../../config/addresses";
import { ManagedRebalanceSwapReentrancy } from "../../../typechain";
import { getOneInchTxData, getSelector, WAD, OneInchSwapParams, wadMulBN } from "../../utils";
import { baseSetup } from "../baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("50");
const BORROW_AMOUNT = ethers.utils.parseEther("5");
const chainAddresses = ADDRESSES["137"];

const setup = deployments.createFixture(async () => {
  const {
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    configProvider,
    mimoVaultActions,
    mimoRebalance,
    mimoManagedRebalance,
    mimoProxyActions,
    mimoProxy,
    multisig,
    mimoProxyGuard,
    dexAddressProvider,
  } = await baseSetup();

  const [owner, managerA, managerB] = await ethers.getSigners();

  // Set managers
  await mimoManagedRebalance.connect(multisig).setManager(managerA.address, true);
  await mimoManagedRebalance.connect(multisig).setManager(managerB.address, true);

  // Create vault to be rebalanced
  await mimoProxy.execute(
    mimoVaultActions.address,
    mimoVaultActions.interface.encodeFunctionData("depositETHAndBorrow", [BORROW_AMOUNT]),
    { value: DEPOSIT_AMOUNT },
  );
  const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);

  // Set permission and management parameters
  const mgtParams = {
    isManaged: true,
    manager: managerA.address,
    allowedVariation: ethers.utils.parseUnits("1", 16), // 1%
    minRatio: ethers.utils.parseUnits("150", 16),
    fixedFee: 0,
    varFee: 0,
    mcrBuffer: ethers.utils.parseUnits("10", 16),
  };

  await mimoProxy.execute(
    mimoProxyActions.address,
    mimoProxyActions.interface.encodeFunctionData("multicall", [
      [mimoProxyGuard.address, mimoManagedRebalance.address],
      [
        mimoProxyGuard.interface.encodeFunctionData("setPermission", [
          mimoManagedRebalance.address,
          mimoRebalance.address,
          getSelector(
            mimoRebalance.interface.functions[
              "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
            ].format(),
          ),
          true,
        ]),
        mimoManagedRebalance.interface.encodeFunctionData("setManagement", [vaultId, mgtParams]),
      ],
    ]),
  );

  // Format mimoRebalance arguments to avoid code duplication
  const deleverageAmount = DEPOSIT_AMOUNT.mul(75).div(100);
  const mintAmount = BORROW_AMOUNT.mul(75).div(100);

  const swapParams: OneInchSwapParams = {
    fromTokenAddress: wmatic.address,
    toTokenAddress: usdc.address,
    amount: deleverageAmount.toString(),
    fromAddress: mimoProxy.address,
    slippage: 1,
    disableEstimate: true,
  };
  const { data } = await getOneInchTxData(swapParams);
  const flData = {
    asset: wmatic.address,
    proxyAction: mimoManagedRebalance.address,
    amount: deleverageAmount,
  };
  const rbData = {
    toCollateral: usdc.address,
    vaultId,
    mintAmount,
  };
  const swapData = {
    dexIndex: 1,
    dexTxData: data.tx.data,
  };

  return {
    owner,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    wmatic,
    mimoRebalance,
    priceFeed,
    stablex,
    usdc,
    vaultId,
    mimoManagedRebalance,
    multisig,
    mimoVaultActions,
    managerA,
    managerB,
    configProvider,
    swapData,
    flData,
    rbData,
    deleverageAmount,
    mintAmount,
    mimoProxyActions,
    dexAddressProvider,
  };
});

describe("--- MIMOManagedRebalance Integration Test ---", function () {
  this.retries(5);
  it("should be able to mimoRebalance from WMATIC to USDC without manager fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoManagedRebalance,
      managerA,
      flData,
      rbData,
      swapData,
      deleverageAmount,
    } = await setup();
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const receipt = await tx.wait(1);
    console.log("Managed mimoRebalance gas used with 1inch : ", receipt.gasUsed.toString());
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVaultIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVaultIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(deleverageAmount)), 5e16);
  });
  it("should be able to mimoRebalance 1inch from USDC to WMATIC without manager fee", async () => {
    const {
      mimoProxy,
      wmatic,
      usdc,
      vaultsDataProvider,
      mimoManagedRebalance,
      multisig,
      mimoVaultActions,
      managerA,
      owner,
    } = await setup();
    const depositAmount = ethers.utils.parseUnits("10", 6);
    await usdc.connect(multisig).transfer(owner.address, depositAmount);
    await usdc.approve(mimoProxy.address, depositAmount);
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("depositAndBorrow", [usdc.address, depositAmount, BORROW_AMOUNT]),
    );
    const vaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    await mimoManagedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: 0,
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    const deleverageAmount = depositAmount.mul(75).div(100);
    const mintAmount = BORROW_AMOUNT.mul(75).div(100);
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: usdc.address,
      toTokenAddress: wmatic.address,
      amount: deleverageAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const flData = {
      asset: usdc.address,
      proxyAction: mimoManagedRebalance.address,
      amount: deleverageAmount,
    };
    const rbData = {
      toCollateral: wmatic.address,
      vaultId,
      mintAmount,
    };
    const swapData = {
      dexIndex: 1,
      dexTxData: data.tx.data,
    };
    const wmaticVaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(wmaticVaultId);
    const usdcCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(wmaticVaultId);
    const usdcCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(usdcCollateralBalanceBefore).to.be.equal(depositAmount);
    expect(Number(usdcCollateralBalanceAfter)).to.be.closeTo(Number(depositAmount.sub(deleverageAmount)), 5e16);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(wmaticCollateralBalanceAfter).to.be.gt(wmaticCollateralBalanceBefore);
  });
  it("should be able to mimoRebalance from WMATIC to USDC without fee with already existing USDC vault", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoManagedRebalance,
      managerA,
      flData,
      rbData,
      swapData,
      deleverageAmount,
      owner,
      multisig,
      mimoVaultActions,
    } = await setup();
    const depositAmount = ethers.utils.parseUnits("10", 6);
    await usdc.connect(multisig).transfer(owner.address, depositAmount);
    await usdc.approve(mimoProxy.address, depositAmount);
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("depositAndBorrow", [usdc.address, depositAmount, BORROW_AMOUNT]),
    );
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(usdcVaultId);
    const usdcVaultDebtBefore = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(usdcVaultId).to.be.gt(ethers.constants.Zero);
    expect(usdcVaultDebtBefore).to.be.gt(ethers.constants.Zero);
    expect(usdcVaultCollateralBalanceBefore).to.be.equal(depositAmount);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(deleverageAmount)), 5e16);
  });
  it("should be able to mimoRebalance with fixed fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoManagedRebalance,
      managerA,
      stablex,
      configProvider,
      rbData,
      flData,
      swapData,
      mintAmount,
    } = await setup();
    await mimoManagedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: ethers.utils.parseEther("1"),
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const managerAParBalance = await stablex.balanceOf(managerA.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    expect(usdcVaultDebt.sub(usdcOriginationFee)).to.be.closeTo(mintAmount, ethers.utils.parseEther("0.01"));
    expect(managerAParBalance).to.be.equal(ethers.utils.parseEther("1"));
  });
  it("should be able to mimoRebalance with variable fee", async () => {
    const {
      mimoProxy,
      priceFeed,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoManagedRebalance,
      managerA,
      stablex,
      configProvider,
      flData,
      swapData,
      rbData,
      deleverageAmount,
      mintAmount,
    } = await setup();
    const varFee = WAD.div(10);

    await mimoManagedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: 0,
      varFee, // 0.1
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const managerAParBalance = await stablex.balanceOf(managerA.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);

    const deleverageValue = await priceFeed.convertFrom(flData.asset, deleverageAmount);
    const managerFee = wadMulBN(deleverageValue, varFee);
    expect(usdcVaultDebt.sub(usdcOriginationFee)).to.be.closeTo(mintAmount, ethers.utils.parseEther("0.01"));
    expect(managerAParBalance).to.be.equal(managerFee);
  });
  it("should be able to mimoRebalance with fixed fee + variable fee", async () => {
    const {
      mimoProxy,
      priceFeed,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoManagedRebalance,
      managerA,
      stablex,
      configProvider,
      swapData,
      rbData,
      flData,
      deleverageAmount,
      mintAmount,
    } = await setup();
    const fixedFee = WAD; // 1 par
    const varFee = WAD.div(100); // .01;
    await mimoManagedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee, // 1 PAR
      varFee, // .01
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const managerAParBalance = await stablex.balanceOf(managerA.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    const deleverageValue = await priceFeed.convertFrom(flData.asset, deleverageAmount);
    const managerVarFee = wadMulBN(deleverageValue, varFee);
    const managerFixedFee = fixedFee;
    const managerFee = managerVarFee.add(managerFixedFee);
    expect(usdcVaultDebt.sub(usdcOriginationFee)).to.be.closeTo(mintAmount, ethers.utils.parseEther("0.01"));
    expect(managerAParBalance).to.be.equal(managerFee);
  });
  it("should revert if vault value variaton is greater than set maximum vault variation", async () => {
    const { vaultId, mimoManagedRebalance, managerA, flData, rbData, swapData } = await setup();
    await mimoManagedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: 0,
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: 0,
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "VAULT_VALUE_CHANGE_TOO_HIGH()",
    );
  });

  it("mimoManagedRebalance should not allow reentrancy for managed rebalances", async () => {
    const { owner, dexAddressProvider, mimoManagedRebalance, flData, rbData, managerA } = await setup();

    const swapData = {
      dexIndex: 999, // Use 999 as the index to allow tests to still work as new dexAPs are added
      dexTxData: "0x", // Call should be reverted before executing dexTxData so we can put arbitrary bytes data
    };

    // Deploy a new dexAddressProvider that simulates a reentrancy attempt
    await deployments.deploy("ManagedRebalanceSwapReentrancy", {
      from: owner.address,
      args: [mimoManagedRebalance.address, flData, rbData, swapData],
    });

    const swapReentrancyAttackContract: ManagedRebalanceSwapReentrancy = await ethers.getContract(
      "ManagedRebalanceSwapReentrancy",
    );

    // Set dex mapping
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [chainAddresses.MULTISIG] });
    const multiSigSigner = await ethers.getSigner(chainAddresses.MULTISIG);
    await dexAddressProvider
      .connect(multiSigSigner)
      .setDexMapping(999, swapReentrancyAttackContract.address, swapReentrancyAttackContract.address);

    // Now try to re-enter mimoRebalance
    await mimoManagedRebalance.setManagement(rbData.vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: WAD.div(10),
      minRatio: WAD.mul(2),
      fixedFee: 0,
      varFee: 0,
      mcrBuffer: WAD.div(10),
    });

    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "ReentrancyGuard: reentrant call",
    );
  });
  it("should revert when paused", async () => {
    const { mimoManagedRebalance, managerA, flData, rbData, swapData } = await setup();
    await mimoManagedRebalance.pause();
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "PAUSED()",
    );
  });
});
