import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers, network } from "hardhat";
import { ADDRESSES } from "../../../config/addresses";
import { POLYGON_ENDPOINT } from "../../../hardhat.config";
import {
  IAddressProvider,
  IConfigProvider,
  IERC20,
  IPriceFeed,
  ISTABLEX,
  IVaultsCore,
  IVaultsDataProvider,
  IWETH,
  MIMOAutoRebalance,
  MIMOProxy,
  MIMOProxyRegistry,
  MIMORebalance,
} from "../../../typechain";
import { MIMOVaultActions } from "../../../typechain/MIMOVaultActions";
import { getOneInchTxData, getSelector, OneInchSwapParams } from "../../utils";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("1000");
const WAD = ethers.utils.parseEther("1");

const setup = deployments.createFixture(async () => {
  const [owner, rebalancer] = await ethers.getSigners();
  const chainAddresses = ADDRESSES["137"];
  process.env.FORK_ID = "137";

  // Fork polygon mainnet
  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: POLYGON_ENDPOINT,
        },
      },
    ],
  });

  // Impersonate multisig
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [chainAddresses.MULTISIG],
  });
  const multisig = await ethers.getSigner(chainAddresses.MULTISIG);

  // Deploy Proxy contracts
  await deployments.fixture(["Proxy", "MIMOAutoRebalance", "MIMOVaultActions"]);

  // Fetch contracts
  const addressProvider: IAddressProvider = await ethers.getContractAt(
    "IAddressProvider",
    chainAddresses.ADDRESS_PROVIDER,
  );
  const [vaultsCoreAddress, vaultsDataProviderAddress, priceFeedAddress, stablexAddress, configProviderAddress] =
    await Promise.all([
      addressProvider.core(),
      addressProvider.vaultsData(),
      addressProvider.priceFeed(),
      addressProvider.stablex(),
      addressProvider.config(),
    ]);

  const [
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    mimoProxyRegistry,
    configProvider,
    vaultActions,
    rebalance,
    autoRebalance,
  ] = (await Promise.all([
    ethers.getContractAt("IVaultsCore", vaultsCoreAddress),
    ethers.getContractAt("IVaultsDataProvider", vaultsDataProviderAddress),
    ethers.getContractAt("IPriceFeed", priceFeedAddress),
    ethers.getContractAt("ISTABLEX", stablexAddress),
    ethers.getContractAt("IWETH", chainAddresses.WMATIC),
    ethers.getContractAt("IERC20", chainAddresses.USDC),
    ethers.getContract("MIMOProxyRegistry"),
    ethers.getContractAt("IConfigProvider", configProviderAddress),
    ethers.getContract("MIMOVaultActions"),
    ethers.getContract("MIMORebalance"),
    ethers.getContract("MIMOAutoRebalance"),
  ])) as [
    IVaultsCore,
    IVaultsDataProvider,
    IPriceFeed,
    ISTABLEX,
    IWETH,
    IERC20,
    MIMOProxyRegistry,
    IConfigProvider,
    MIMOVaultActions,
    MIMORebalance,
    MIMOAutoRebalance,
  ];

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

  // Set managers
  await owner.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther("20") });

  // Create vault to be rebalanced 5% below trigger ratio i.e 255%
  const depositValue = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
  const borrowAmount = depositValue.mul(100).div(255);
  await mimoProxy.execute(
    vaultActions.address,
    vaultActions.interface.encodeFunctionData("depositETHAndBorrow", [borrowAmount]),
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
    fixedFee: 0,
    varFee: 0,
  };
  await mimoProxy.batch(
    [
      mimoProxy.interface.encodeFunctionData("setPermission", [
        autoRebalance.address,
        rebalance.address,
        getSelector(
          rebalance.interface.functions[
            "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
          ].format(),
        ),
        true,
      ]),
      mimoProxy.interface.encodeFunctionData("multicall", [
        [autoRebalance.address],
        [autoRebalance.interface.encodeFunctionData("setAutomation", [vaultId, autoVault])],
      ]),
    ],
    true,
  );

  // Set automation parameters
  const amounts = await autoRebalance.getAmounts(vaultId, usdc.address);

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

  return {
    owner,
    rebalancer,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    wmatic,
    rebalance,
    priceFeed,
    stablex,
    usdc,
    vaultId,
    autoRebalance,
    multisig,
    vaultActions,
    autoVault,
    configProvider,
    swapData,
    amounts,
  };
});

describe("--- MIMOAutoRebalance Integration Test ---", () => {
  it("should calculate rebalance and mint amount correctly", async () => {
    const { autoRebalance, vaultId, usdc, autoVault, configProvider, priceFeed, vaultsDataProvider, wmatic } =
      await setup();
    const amounts = await autoRebalance.getAmounts(vaultId, usdc.address);
    const { mcrBuffer, targetRatio } = autoVault;
    const collateralValue = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const usdcMcr = await configProvider.collateralMinCollateralRatio(usdc.address);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const _targetRatio = targetRatio.add(1e15);
    const e1 = _targetRatio.mul(vaultDebt);
    const e2 = e1.sub(collateralValue.mul(WAD));
    const e3 = _targetRatio.mul(WAD).div(usdcMcr.add(mcrBuffer)).sub(WAD);
    const rebalanceValue = e2.div(e3);
    const rebalanceAmount = await priceFeed.convertTo(wmatic.address, rebalanceValue);
    const mintAmount = rebalanceValue.mul(WAD).div(usdcMcr.add(mcrBuffer));
    expect(Number(amounts.rebalanceAmount.sub(rebalanceAmount))).to.be.closeTo(0, 50);
    expect(Number(amounts.mintAmount.sub(mintAmount))).to.be.closeTo(0, 50);
  });
  it("should be able to rebalance from WMATIC to USDC without fee", async () => {
    const { mimoProxy, usdc, vaultId, vaultsDataProvider, autoRebalance, swapData, amounts } = await setup();
    const { rebalanceAmount } = amounts;
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await autoRebalance.rebalance(vaultId, swapData);
    const receipt = await tx.wait(1);
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    console.log("Auto rebalance gas used with 1inch : ", receipt.gasUsed.toString());
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVaultIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const operatioTracker = await autoRebalance.getOperationTracker(vaultId);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVaultIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 5e16);
    expect(operatioTracker).to.be.equal(block.timestamp);
  });
  it("should be able to rebalance from WMATIC to USDC without fee with already existing USDC vault", async () => {
    const { mimoProxy, usdc, vaultId, vaultsDataProvider, autoRebalance, swapData, amounts, owner, vaultActions } =
      await setup();

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
      vaultActions.address,
      vaultActions.interface.encodeFunctionData("depositAndBorrow", [
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
    await autoRebalance.rebalance(vaultId, swapData);
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(usdcVaultId).to.be.gt(ethers.constants.Zero);
    expect(usdcVaultDebtBefore).to.be.gt(ethers.constants.Zero);
    expect(usdcVaultCollateralBalanceBefore).to.be.equal(usdcDepositAmount);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 5e16);
  });
  it("should be able to rebalance with variable fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      autoRebalance,
      stablex,
      configProvider,
      rebalancer,
      wmatic,
      priceFeed,
    } = await setup();
    await autoRebalance.setAutomation(vaultId, {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseEther("0.01"),
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: 0,
      varFee: ethers.utils.parseEther("0.1"), // 10%
    });
    const amounts = await autoRebalance.getAmounts(vaultId, usdc.address);
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
    await autoRebalance.connect(rebalancer).rebalance(vaultId, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const rebalancerStablexBalance = await stablex.balanceOf(rebalancer.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    const autoFeeAmount = amounts.rebalanceAmount.mul(ethers.utils.parseEther("0.1")).div(WAD);
    const autoFeeValue = await priceFeed.convertFrom(wmatic.address, autoFeeAmount);
    const totalMinted = amounts.mintAmount.add(autoFeeValue);
    const totalDebt = totalMinted.add(totalMinted.mul(usdcOriginationFee).div(WAD));
    expect(Number(usdcVaultDebt.sub(totalDebt))).to.be.closeTo(0, 2);
    expect(Number(rebalancerStablexBalance.sub(autoFeeValue))).to.be.closeTo(0, 2);
  });
  it("should be able to rebalance with fixed feed + variable fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      autoRebalance,
      stablex,
      configProvider,
      rebalancer,
      wmatic,
      priceFeed,
    } = await setup();
    await autoRebalance.setAutomation(vaultId, {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseEther("0.01"),
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: ethers.utils.parseEther("0.1"),
      varFee: ethers.utils.parseEther("0.1"), // 10%,
    });
    const amounts = await autoRebalance.getAmounts(vaultId, usdc.address);
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
    await autoRebalance.connect(rebalancer).rebalance(vaultId, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const rebalancerStablexBalance = await stablex.balanceOf(rebalancer.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    const varFeeAmount = amounts.rebalanceAmount.mul(ethers.utils.parseEther("0.1")).div(WAD);
    const varFeeValue = await priceFeed.convertFrom(wmatic.address, varFeeAmount);
    const autoFeeValue = varFeeValue.add(ethers.utils.parseEther("0.1"));
    const totalMinted = amounts.mintAmount.add(autoFeeValue);
    const totalDebt = totalMinted.add(totalMinted.mul(usdcOriginationFee).div(WAD));
    expect(Number(usdcVaultDebt.sub(totalDebt))).to.be.closeTo(0, 3);
    expect(Number(rebalancerStablexBalance.sub(autoFeeValue))).to.be.closeTo(0, 2);
  });
  it("should revert if vault value variation is greater than set maximum vault variation", async () => {
    const { usdc, vaultId, autoRebalance, swapData } = await setup();
    await autoRebalance.setAutomation(vaultId, {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: 0,
      targetRatio: ethers.utils.parseEther("2.7"),
      triggerRatio: ethers.utils.parseEther("2.6"),
      mcrBuffer: ethers.utils.parseEther("0.1"),
      fixedFee: 0,
      varFee: 0,
    });
    await expect(autoRebalance.rebalance(vaultId, swapData)).to.be.revertedWith("VAULT_VALUE_CHANGE_TOO_HIGH()");
  });
  it("should revert if operation tracker has reached max daily call limit", async () => {
    const { vaultId, autoRebalance, swapData } = await setup();
    await autoRebalance.rebalance(vaultId, swapData);
    await expect(autoRebalance.rebalance(vaultId, swapData)).to.be.revertedWith("MAX_OPERATIONS_REACHED()");
  });
});
