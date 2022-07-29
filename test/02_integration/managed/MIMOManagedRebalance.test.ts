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
  MIMOManagedRebalance,
  MIMOProxy,
  MIMOProxyRegistry,
  MIMORebalance,
} from "../../../typechain";
import { MIMOVaultActions } from "../../../typechain/MIMOVaultActions";
import { getOneInchTxData, getSelector, OneInchSwapParams } from "../../utils";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("50");
const BORROW_AMOUNT = ethers.utils.parseEther("5");

const setup = deployments.createFixture(async () => {
  const [owner, managerA, managerB] = await ethers.getSigners();
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
  await deployments.fixture(["Proxy", "MIMOManagedRebalance", "MIMOVaultActions"]);

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
    managedRebalance,
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
    ethers.getContract("MIMOManagedRebalance"),
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
    MIMOManagedRebalance,
  ];

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

  // Set managers
  await owner.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther("20") });
  await managedRebalance.connect(multisig).setManager(managerA.address, true);
  await managedRebalance.connect(multisig).setManager(managerB.address, true);

  // Create vault to be rebalanced
  await mimoProxy.execute(
    vaultActions.address,
    vaultActions.interface.encodeFunctionData("depositETHAndBorrow", [BORROW_AMOUNT]),
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

  await mimoProxy.batch(
    [
      mimoProxy.interface.encodeFunctionData("setPermission", [
        managedRebalance.address,
        rebalance.address,
        getSelector(
          rebalance.interface.functions[
            "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
          ].format(),
        ),
        true,
      ]),
      mimoProxy.interface.encodeFunctionData("multicall", [
        [managedRebalance.address],
        [managedRebalance.interface.encodeFunctionData("setManagement", [vaultId, mgtParams])],
      ]),
    ],
    true,
  );

  // Format rebalance arguments to avoid code duplication
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
    proxyAction: managedRebalance.address,
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
    rebalance,
    priceFeed,
    stablex,
    usdc,
    vaultId,
    managedRebalance,
    multisig,
    vaultActions,
    managerA,
    managerB,
    configProvider,
    swapData,
    flData,
    rbData,
    deleverageAmount,
    mintAmount,
  };
});

describe("--- MIMOManagedRebalance Integration Test ---", () => {
  it("should be able to rebalance from WMATIC to USDC without manager fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      managedRebalance,
      managerA,
      flData,
      rbData,
      swapData,
      deleverageAmount,
    } = await setup();
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await managedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const receipt = await tx.wait(1);
    console.log("Managed rebalance gas used with 1inch : ", receipt.gasUsed.toString());
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVaultIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVaultIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(deleverageAmount)), 5e16);
  });
  it("should be able to rebalance 1inch from USDC to WMATIC without manager fee", async () => {
    const { mimoProxy, wmatic, usdc, vaultsDataProvider, managedRebalance, multisig, vaultActions, managerA, owner } =
      await setup();
    const depositAmount = ethers.utils.parseUnits("10", 6);
    await usdc.connect(multisig).transfer(owner.address, depositAmount);
    await usdc.approve(mimoProxy.address, depositAmount);
    await mimoProxy.execute(
      vaultActions.address,
      vaultActions.interface.encodeFunctionData("depositAndBorrow", [usdc.address, depositAmount, BORROW_AMOUNT]),
    );
    const vaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    await managedRebalance.setManagement(vaultId, {
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
      proxyAction: managedRebalance.address,
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
    await managedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(wmaticVaultId);
    const usdcCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(usdcCollateralBalanceBefore).to.be.equal(depositAmount);
    expect(Number(usdcCollateralBalanceAfter)).to.be.closeTo(Number(depositAmount.sub(deleverageAmount)), 5e16);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(wmaticCollateralBalanceAfter).to.be.gt(wmaticCollateralBalanceBefore);
  });
  it("should be able to rebalance from WMATIC to USDC without fee with already existing USDC vault", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      managedRebalance,
      managerA,
      flData,
      rbData,
      swapData,
      deleverageAmount,
      owner,
      multisig,
      vaultActions,
    } = await setup();
    const depositAmount = ethers.utils.parseUnits("10", 6);
    await usdc.connect(multisig).transfer(owner.address, depositAmount);
    await usdc.approve(mimoProxy.address, depositAmount);
    await mimoProxy.execute(
      vaultActions.address,
      vaultActions.interface.encodeFunctionData("depositAndBorrow", [usdc.address, depositAmount, BORROW_AMOUNT]),
    );
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(usdcVaultId);
    const usdcVaultDebtBefore = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await managedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(usdcVaultId).to.be.gt(ethers.constants.Zero);
    expect(usdcVaultDebtBefore).to.be.gt(ethers.constants.Zero);
    expect(usdcVaultCollateralBalanceBefore).to.be.equal(depositAmount);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(deleverageAmount)), 5e16);
  });
  it("should be able to rebalance with fixed fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      managedRebalance,
      managerA,
      stablex,
      configProvider,
      rbData,
      flData,
      swapData,
      mintAmount,
    } = await setup();
    await managedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: ethers.utils.parseEther("1"),
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await managedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const managerAParBalance = await stablex.balanceOf(managerA.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    const totalMinted = mintAmount.add(ethers.utils.parseEther("1"));
    const totalDebt = totalMinted.add(totalMinted.mul(usdcOriginationFee).div(ethers.utils.parseEther("1")));
    expect(Number(usdcVaultDebt.sub(totalDebt))).to.be.closeTo(0, 1);
    expect(managerAParBalance).to.be.equal(ethers.utils.parseEther("1"));
  });
  it("should be able to rebalance with variable fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      managedRebalance,
      managerA,
      stablex,
      configProvider,
      flData,
      swapData,
      rbData,
      deleverageAmount,
      mintAmount,
    } = await setup();
    await managedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: 0,
      varFee: ethers.utils.parseUnits("1", 17), // 10%
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await managedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const managerAParBalance = await stablex.balanceOf(managerA.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    const managerFee = deleverageAmount.mul(ethers.utils.parseUnits("1", 17)).div(ethers.utils.parseEther("1"));
    const totalMinted = mintAmount.add(managerFee);
    const totalDebt = totalMinted.add(totalMinted.mul(usdcOriginationFee).div(ethers.utils.parseEther("1")));
    expect(Number(usdcVaultDebt.sub(totalDebt))).to.be.closeTo(0, 1);
    expect(managerAParBalance).to.be.equal(managerFee);
  });
  it("should be able to rebalance with fixed fee + variable fee", async () => {
    const {
      mimoProxy,
      usdc,
      vaultId,
      vaultsDataProvider,
      managedRebalance,
      managerA,
      stablex,
      configProvider,
      swapData,
      rbData,
      flData,
      deleverageAmount,
      mintAmount,
    } = await setup();
    await managedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: ethers.utils.parseEther("1"),
      varFee: ethers.utils.parseUnits("1", 17), // 10%
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await managedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const usdcVaultId = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const usdcVaultDebt = await vaultsDataProvider.vaultDebt(usdcVaultId);
    const managerAParBalance = await stablex.balanceOf(managerA.address);
    const usdcOriginationFee = await configProvider.collateralOriginationFee(usdc.address);
    const managerFee = deleverageAmount
      .mul(ethers.utils.parseUnits("1", 17))
      .div(ethers.utils.parseEther("1"))
      .add(ethers.utils.parseEther("1"));
    const totalMinted = mintAmount.add(managerFee);
    const totalDebt = totalMinted.add(totalMinted.mul(usdcOriginationFee).div(ethers.utils.parseEther("1")));
    expect(usdcVaultDebt).to.be.equal(totalDebt);
    expect(managerAParBalance).to.be.equal(managerFee);
  });
  it("should revert if vault value variaton is greater than set maximum vault variation", async () => {
    const { vaultId, managedRebalance, managerA, flData, rbData, swapData } = await setup();
    await managedRebalance.setManagement(vaultId, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: 0,
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: 0,
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await expect(managedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "VAULT_VALUE_CHANGE_TOO_HIGH()",
    );
  });
});
