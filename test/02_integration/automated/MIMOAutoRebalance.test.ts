import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { getOneInchTxData, getSelector, OneInchSwapParams, WAD, wadDivBN, wadMulBN } from "../../utils";
import { baseSetup } from "../baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("1000");
const PERCENTAGE_FACTOR = ethers.BigNumber.from(1e4);

const setup = deployments.createFixture(async () => {
  const {
    owner,
    multisig,
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    mimoProxy,
    configProvider,
    mimoVaultActions,
    mimoRebalance,
    mimoAutoRebalance,
    mimoProxyActions,
    mimoProxyGuard,
    premium,
  } = await baseSetup();

  const [, rebalancer] = await ethers.getSigners();

  // Create vault to be rebalanced 5% below trigger ratio i.e 255%
  const depositValue = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
  const borrowAmount = depositValue.mul(100).div(255);

  await mimoProxy.execute(
    mimoVaultActions.address,
    mimoVaultActions.interface.encodeFunctionData("depositETHAndBorrow", [borrowAmount]),
    { value: DEPOSIT_AMOUNT },
  );

  const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);

  // Set permission and automation parameters
  const autoVault = {
    isAutomated: true,
    toCollateral: usdc.address,
    allowedVariation: ethers.utils.parseEther("0.01"),
    targetRatio: ethers.utils.parseEther("2.7"),
    triggerRatio: ethers.utils.parseEther("2.6"),
    mcrBuffer: ethers.utils.parseEther("0.1"),
    fixedFee: ethers.constants.Zero,
    varFee: ethers.constants.Zero,
  };

  await mimoProxy.execute(
    mimoProxyActions.address,
    mimoProxyActions.interface.encodeFunctionData("multicall", [
      [mimoProxyGuard.address, mimoAutoRebalance.address],
      [
        mimoProxyGuard.interface.encodeFunctionData("setPermission", [
          mimoAutoRebalance.address,
          mimoRebalance.address,
          getSelector(
            mimoRebalance.interface.functions[
              "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
            ].format(),
          ),
          true,
        ]),
        mimoAutoRebalance.interface.encodeFunctionData("setAutomation", [vaultId, autoVault]),
      ],
    ]),
  );

  // Set automation parameters
  const amounts = await mimoAutoRebalance.getAmounts(vaultId, usdc.address);

  const swapParams: OneInchSwapParams = {
    fromTokenAddress: wmatic.address,
    toTokenAddress: usdc.address,
    amount: amounts.rebalanceAmount.toString(),
    fromAddress: mimoProxy.address,
    slippage: 1,
    disableEstimate: true,
  };
  const { data } = await getOneInchTxData(swapParams);

  const swapData = {
    dexIndex: 1,
    dexTxData: data.tx.data,
  };

  const calculateRebalanceValue = (
    targetRatio: BigNumber,
    collateralValue: BigNumber,
    vaultDebt: BigNumber,
    mcrB: BigNumber,
    mcrBuffer: BigNumber,
    fixedFee: BigNumber,
    varFee: BigNumber,
  ) => {
    targetRatio = targetRatio.add(1e15);
    mcrB = mcrB.add(mcrBuffer);
    return wadDivBN(
      wadMulBN(targetRatio, vaultDebt.add(fixedFee)).sub(collateralValue),
      wadDivBN(targetRatio.mul(PERCENTAGE_FACTOR).sub(mcrB.mul(premium)), mcrB.mul(PERCENTAGE_FACTOR))
        .sub(wadMulBN(targetRatio, varFee))
        .sub(WAD),
    );
  };

  return {
    owner,
    rebalancer,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    wmatic,
    mimoRebalance,
    priceFeed,
    stablex,
    usdc,
    vaultId,
    mimoAutoRebalance,
    multisig,
    mimoVaultActions,
    autoVault,
    configProvider,
    swapData,
    amounts,
    mimoProxyActions,
    premium,
    calculateRebalanceValue,
  };
});

describe("--- MIMOAutoRebalance Integration Test ---", function () {
  this.retries(5);
  it("should calculate mimoRebalance and mint amount correctly without fees", async () => {
    const {
      mimoAutoRebalance,
      vaultId,
      usdc,
      autoVault,
      configProvider,
      priceFeed,
      vaultsDataProvider,
      wmatic,
      calculateRebalanceValue,
    } = await setup();
    const { mcrBuffer, targetRatio, fixedFee, varFee } = autoVault;
    const usdcMcr = await configProvider.collateralMinCollateralRatio(usdc.address);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const collateralValue = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const amounts = await mimoAutoRebalance.getAmounts(vaultId, usdc.address);
    const rebalanceValue = calculateRebalanceValue(
      targetRatio,
      collateralValue,
      vaultDebt,
      usdcMcr,
      mcrBuffer,
      fixedFee,
      varFee,
    );
    const rebalanceAmount = await priceFeed.convertTo(wmatic.address, rebalanceValue);
    const mintAmount = rebalanceValue.mul(WAD).div(usdcMcr.add(mcrBuffer));
    expect(amounts.rebalanceAmount).to.be.closeTo(rebalanceAmount, 1);
    expect(amounts.mintAmount).to.be.closeTo(mintAmount, 1);
  });
  it("should calculate mimoRebalance and mint amount correctly with fixed fee", async () => {
    const {
      mimoAutoRebalance,
      vaultId,
      usdc,
      configProvider,
      priceFeed,
      vaultsDataProvider,
      wmatic,
      calculateRebalanceValue,
    } = await setup();
    const autoVault = {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseEther("0.01"),
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: ethers.utils.parseEther("5"),
      varFee: ethers.constants.Zero,
    };
    await mimoAutoRebalance.setAutomation(vaultId, autoVault);
    const amounts = await mimoAutoRebalance.getAmounts(vaultId, usdc.address);
    const { mcrBuffer, targetRatio, fixedFee, varFee } = autoVault;
    const usdcMcr = await configProvider.collateralMinCollateralRatio(usdc.address);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const collateralValue = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const rebalanceValue = calculateRebalanceValue(
      targetRatio,
      collateralValue,
      vaultDebt,
      usdcMcr,
      mcrBuffer,
      fixedFee,
      varFee,
    );
    const rebalanceAmount = await priceFeed.convertTo(wmatic.address, rebalanceValue);
    const mintAmount = rebalanceValue.mul(WAD).div(usdcMcr.add(mcrBuffer));
    expect(amounts.rebalanceAmount).to.be.closeTo(rebalanceAmount, 1);
    expect(amounts.mintAmount).to.be.closeTo(mintAmount, 1);
  });
  it("should calculate mimoRebalance and mint amount correctly with variable fee", async () => {
    const {
      mimoAutoRebalance,
      vaultId,
      usdc,
      configProvider,
      priceFeed,
      vaultsDataProvider,
      wmatic,
      calculateRebalanceValue,
    } = await setup();
    const autoVault = {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseEther("0.01"),
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: ethers.constants.Zero,
      varFee: ethers.utils.parseEther("0.02"), // 2%
    };
    await mimoAutoRebalance.setAutomation(vaultId, autoVault);
    const amounts = await mimoAutoRebalance.getAmounts(vaultId, usdc.address);
    const { mcrBuffer, targetRatio, fixedFee, varFee } = autoVault;
    const usdcMcr = await configProvider.collateralMinCollateralRatio(usdc.address);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const collateralValue = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const rebalanceValue = calculateRebalanceValue(
      targetRatio,
      collateralValue,
      vaultDebt,
      usdcMcr,
      mcrBuffer,
      fixedFee,
      varFee,
    );
    const rebalanceAmount = await priceFeed.convertTo(wmatic.address, rebalanceValue);
    const mintAmount = rebalanceValue.mul(WAD).div(usdcMcr.add(mcrBuffer));
    expect(amounts.rebalanceAmount).to.be.closeTo(rebalanceAmount, 1);
    expect(amounts.mintAmount).to.be.closeTo(mintAmount, 1);
  });
  it("should calculate mimoRebalance and mint amount correctly with variable fee and fixedFee", async () => {
    const {
      mimoAutoRebalance,
      vaultId,
      usdc,
      configProvider,
      priceFeed,
      vaultsDataProvider,
      wmatic,
      calculateRebalanceValue,
    } = await setup();
    const autoVault = {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseEther("0.01"),
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: ethers.utils.parseEther("5"),
      varFee: ethers.utils.parseEther("0.02"), // 2%
    };
    await mimoAutoRebalance.setAutomation(vaultId, autoVault);
    const amounts = await mimoAutoRebalance.getAmounts(vaultId, usdc.address);
    const { mcrBuffer, targetRatio, fixedFee, varFee } = autoVault;
    const usdcMcr = await configProvider.collateralMinCollateralRatio(usdc.address);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const collateralValue = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const rebalanceValue = calculateRebalanceValue(
      targetRatio,
      collateralValue,
      vaultDebt,
      usdcMcr,
      mcrBuffer,
      fixedFee,
      varFee,
    );
    const rebalanceAmount = await priceFeed.convertTo(wmatic.address, rebalanceValue);
    const mintAmount = rebalanceValue.mul(WAD).div(usdcMcr.add(mcrBuffer));
    expect(amounts.rebalanceAmount).to.be.closeTo(rebalanceAmount, 50);
    expect(amounts.mintAmount).to.be.closeTo(mintAmount, 50);
  });
  it("should be able to mimoRebalance from WMATIC to USDC without fee", async () => {
    const { mimoProxy, usdc, vaultId, vaultsDataProvider, mimoAutoRebalance, swapData, amounts } = await setup();
    const { rebalanceAmount } = amounts;
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoAutoRebalance.rebalance(vaultId, swapData);
    const receipt = await tx.wait(1);
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    console.log("Auto mimoRebalance gas used with 1inch : ", receipt.gasUsed.toString());
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVaultIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const operatioTracker = await mimoAutoRebalance.getOperationTracker(vaultId);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVaultIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 5e16);
    expect(operatioTracker).to.be.equal(block.timestamp);
  });
  it("should be able to mimoRebalance from WMATIC to USDC without fee with already existing USDC vault", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoAutoRebalance,
      swapData,
      amounts,
      owner,
      mimoVaultActions,
    } = await setup();

    // Impresonate BinanceWallet to get USDC
    const usdcDepositAmount = ethers.utils.parseUnits("100", 6);
    const usdcVaultMintAmount = ethers.utils.parseEther("50");
    const polygonBinance = "0xf977814e90da44bfa03b6295a0616a897441acec";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [polygonBinance],
    });
    const binanceWallet = await ethers.getSigner(polygonBinance);
    await usdc.connect(binanceWallet).transfer(owner.address, usdcDepositAmount);
    await usdc.approve(mimoProxy.address, usdcDepositAmount);

    // Open USDC vault
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("depositAndBorrow", [
        usdc.address,
        usdcDepositAmount,
        usdcVaultMintAmount,
      ]),
    );
    const { rebalanceAmount } = amounts;
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(usdcVaultId);
    const usdcVaultDebtBefore = await vaultsDataProvider.vaultDebt(usdcVaultId);
    await mimoAutoRebalance.rebalance(vaultId, swapData);
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(usdcVaultId).to.be.gt(ethers.constants.Zero);
    expect(usdcVaultDebtBefore).to.be.gt(ethers.constants.Zero);
    expect(usdcVaultCollateralBalanceBefore).to.be.equal(usdcDepositAmount);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 5e16);
  });
  it("should be able to mimoRebalance with variable fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoAutoRebalance,
      stablex,
      configProvider,
      rebalancer,
      wmatic,
      priceFeed,
    } = await setup();
    await mimoAutoRebalance.setAutomation(vaultId, {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseEther("0.01"),
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: 0,
      varFee: ethers.utils.parseEther("0.1"), // 10%
    });
    const amounts = await mimoAutoRebalance.getAmounts(vaultId, usdc.address);
    const { rebalanceAmount, mintAmount } = amounts;
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: usdc.address,
      amount: rebalanceAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const swapData = {
      dexIndex: 1,
      dexTxData: data.tx.data,
    };
    await mimoAutoRebalance.connect(rebalancer).rebalance(vaultId, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const rebalancerStablexBalance = await stablex.balanceOf(rebalancer.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    const autoFeeAmount = wadMulBN(rebalanceAmount, ethers.utils.parseEther("0.1"));
    const autoFeeValue = await priceFeed.convertFrom(wmatic.address, autoFeeAmount);
    expect(usdcVaultDebt.sub(wadMulBN(usdcVaultDebt, usdcOriginationFee))).to.be.closeTo(
      mintAmount,
      ethers.utils.parseEther("0.01"),
    );
    expect(rebalancerStablexBalance).to.be.closeTo(autoFeeValue, 1);
  });
  it("should be able to mimoRebalance with fixed feed + variable fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoAutoRebalance,
      stablex,
      configProvider,
      rebalancer,
      wmatic,
      priceFeed,
    } = await setup();
    await mimoAutoRebalance.setAutomation(vaultId, {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseEther("0.01"),
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: ethers.utils.parseEther("0.1"),
      varFee: ethers.utils.parseEther("0.1"), // 10%,
    });
    const amounts = await mimoAutoRebalance.getAmounts(vaultId, usdc.address);
    const { rebalanceAmount, mintAmount } = amounts;
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: usdc.address,
      amount: rebalanceAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const swapData = {
      dexIndex: 1,
      dexTxData: data.tx.data,
    };
    await mimoAutoRebalance.connect(rebalancer).rebalance(vaultId, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const rebalancerStablexBalance = await stablex.balanceOf(rebalancer.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    const varFeeAmount = wadMulBN(rebalanceAmount, ethers.utils.parseEther("0.1"));
    const varFeeValue = await priceFeed.convertFrom(wmatic.address, varFeeAmount);
    const autoFeeValue = varFeeValue.add(ethers.utils.parseEther("0.1"));
    expect(usdcVaultDebt.sub(wadMulBN(usdcVaultDebt, usdcOriginationFee))).to.be.closeTo(
      mintAmount,
      ethers.utils.parseEther("0.01"),
    );
    expect(rebalancerStablexBalance).to.be.closeTo(autoFeeValue, 1);
  });
  it("should revert if vault value variation is greater than set maximum vault variation", async () => {
    const { usdc, vaultId, mimoAutoRebalance, swapData } = await setup();
    await mimoAutoRebalance.setAutomation(vaultId, {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: 0,
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: 0,
      varFee: 0,
    });
    await expect(mimoAutoRebalance.rebalance(vaultId, swapData)).to.be.revertedWith("VAULT_VALUE_CHANGE_TOO_HIGH()");
  });
  it("should revert if operation tracker has reached max daily call limit", async () => {
    const { vaultId, mimoAutoRebalance, swapData } = await setup();
    await mimoAutoRebalance.rebalance(vaultId, swapData);
    await expect(mimoAutoRebalance.rebalance(vaultId, swapData)).to.be.revertedWith("MAX_OPERATIONS_REACHED()");
  });
});
