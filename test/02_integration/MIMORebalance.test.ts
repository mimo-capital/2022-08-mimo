import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import { ADDRESSES } from "../../config/addresses";
import { POLYGON_ENDPOINT } from "../../hardhat.config";
import {
  IAddressProvider,
  IERC20,
  IPool,
  IPriceFeed,
  ISTABLEX,
  IVaultsCore,
  IVaultsDataProvider,
  IWETH,
  MIMOProxy,
  MIMOProxyRegistry,
  MIMORebalance,
} from "../../typechain";
import { MIMOVaultActions } from "../../typechain/MIMOVaultActions";
import { getOneInchTxData, getParaswapPriceRoute, getParaswapTxData, getSelector, OneInchSwapParams } from "../utils";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");

const setup = deployments.createFixture(async () => {
  const [owner] = await ethers.getSigners();
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

  // Deploy Proxy contracts
  await deployments.fixture(["Proxy", "MIMORebalance", "MIMOVaultActions"]);

  // Fetch contracts
  const chainAddresses = ADDRESSES["137"];
  const addressProvider: IAddressProvider = await ethers.getContractAt(
    "IAddressProvider",
    chainAddresses.ADDRESS_PROVIDER,
  );
  const [vaultsCoreAddress, vaultsDataProviderAddress, priceFeedAddress, stablexAddress] = await Promise.all([
    addressProvider.core(),
    addressProvider.vaultsData(),
    addressProvider.priceFeed(),
    addressProvider.stablex(),
  ]);

  const [
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    mimoProxyRegistry,
    lendingPool,
    vaultActions,
    rebalance,
  ] = (await Promise.all([
    ethers.getContractAt("IVaultsCore", vaultsCoreAddress),
    ethers.getContractAt("IVaultsDataProvider", vaultsDataProviderAddress),
    ethers.getContractAt("IPriceFeed", priceFeedAddress),
    ethers.getContractAt("ISTABLEX", stablexAddress),
    ethers.getContractAt("IWETH", chainAddresses.WMATIC),
    ethers.getContractAt("IERC20", chainAddresses.USDC),
    ethers.getContract("MIMOProxyRegistry"),
    ethers.getContractAt("IPool", chainAddresses.AAVE_POOL),
    ethers.getContract("MIMOVaultActions"),
    ethers.getContract("MIMORebalance"),
  ])) as [
    IVaultsCore,
    IVaultsDataProvider,
    IPriceFeed,
    ISTABLEX,
    IWETH,
    IERC20,
    MIMOProxyRegistry,
    IPool,
    MIMOVaultActions,
    MIMORebalance,
  ];

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

  // Set permission on deployed MIMOProxy for MIMORebalance callback
  await mimoProxy.setPermission(
    rebalance.address,
    rebalance.address,
    getSelector(
      rebalance.interface.functions[
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
      ].format(),
    ),
    true,
  );

  // Get WMATIC
  await wmatic.deposit({ value: DEPOSIT_AMOUNT });
  await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);

  // Create vault to be rebalanced
  const depositData = vaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]);
  await mimoProxy.execute(vaultActions.address, depositData);
  const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);

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
    lendingPool,
  };
});

describe("--- MIMORebalance Integration Tests ---", () => {
  it("should be able to rebalance with 1inch", async () => {
    const { mimoProxy, rebalance, wmatic, priceFeed, usdc, vaultId, vaultsDataProvider } = await setup();
    const wmaticPrice = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const rebalanceAmount = DEPOSIT_AMOUNT.mul(75).div(100);
    const mintAmount = wmaticPrice.mul(70).div(110);
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: usdc.address,
      amount: rebalanceAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const rebalanceData = [
      [wmatic.address, rebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(rebalance.address, MIMOProxyData);
    const receipt = await tx.wait(1);
    console.log("Rebalance gas used with 1inch : ", receipt.gasUsed.toString());
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVautIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVautIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 1e16);
  });
  it("should be able to rebalance with paraswap", async () => {
    const { mimoProxy, rebalance, wmatic, priceFeed, usdc, vaultId, vaultsDataProvider } = await setup();
    const wmaticPrice = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const rebalanceAmount = DEPOSIT_AMOUNT.mul(75).div(100);
    const mintAmount = wmaticPrice.mul(70).div(110);
    const pricesParams = {
      srcToken: wmatic.address,
      destToken: usdc.address,
      side: "SELL",
      network: 137,
      srcDecimals: 18,
      destDecimals: 18,
      amount: rebalanceAmount.toString(),
    };

    // Call Paraswap
    const routeData = await getParaswapPriceRoute(pricesParams);

    const bodyParams = {
      srcToken: wmatic.address,
      destToken: usdc.address,
      priceRoute: routeData.data.priceRoute,
      srcAmount: rebalanceAmount.toString(),
      slippage: 100, // 1% slippage
      userAddress: rebalance.address,
    };

    // We now use the paraswap API to get the best route to sell the PAR we just loaned
    const { data } = await getParaswapTxData(bodyParams);

    const rebalanceData = [
      [wmatic.address, rebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [0, data.data],
    ];
    const MIMOProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(rebalance.address, MIMOProxyData);
    const receipt = await tx.wait(1);
    console.log("Rebalance gas used with paraswap : ", receipt.gasUsed.toString());
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVautIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVautIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 1e16);
  });
  it("should be able to setPermission and rebalance in 1 tx", async () => {
    const { mimoProxy, rebalance, wmatic, priceFeed, usdc, vaultId, vaultsDataProvider } = await setup();
    const rebalanceSelector = getSelector(
      rebalance.interface.functions[
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
      ].format(),
    );
    await mimoProxy.setPermission(rebalance.address, rebalance.address, rebalanceSelector, false);
    const permission = await mimoProxy.getPermission(rebalance.address, rebalance.address, rebalanceSelector);
    const wmaticPrice = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const rebalanceAmount = DEPOSIT_AMOUNT.mul(75).div(100);
    const mintAmount = wmaticPrice.mul(70).div(110);
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: usdc.address,
      amount: rebalanceAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const rebalanceData = [
      [wmatic.address, rebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const mimoProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await mimoProxy.batch(
      [
        mimoProxy.interface.encodeFunctionData("setPermission", [
          rebalance.address,
          rebalance.address,
          rebalanceSelector,
          true,
        ]),
        mimoProxy.interface.encodeFunctionData("execute", [rebalance.address, mimoProxyData]),
      ],
      true,
    );
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVautIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(permission).to.be.false;
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVautIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 1e16);
  });
  it("should be able to rebalance 100%", async () => {
    const { mimoProxy, rebalance, wmatic, usdc, vaultId, vaultsDataProvider, lendingPool } = await setup();
    const premium = await lendingPool.FLASHLOAN_PREMIUM_TOTAL();
    const rebalanceAmount = DEPOSIT_AMOUNT.mul(1e8).div(premium.add(1e4)).div(1e4);
    const mintAmount = await vaultsDataProvider.vaultDebt(vaultId);
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: usdc.address,
      amount: rebalanceAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const rebalanceData = [
      [wmatic.address, rebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await mimoProxy.execute(rebalance.address, MIMOProxyData);
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVautIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVautIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(wmaticCollateralBalanceAfter).to.be.equal(ethers.constants.Zero);
  });
  it("it should revert if flashloan cannot be repaid", async () => {
    const { mimoProxy, rebalance, wmatic, priceFeed, usdc, vaultId } = await setup();
    const wmaticPrice = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const rebalanceAmount = DEPOSIT_AMOUNT;
    const mintAmount = wmaticPrice.mul(70).div(110);
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: usdc.address,
      amount: rebalanceAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const rebalanceData = [
      [wmatic.address, rebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await expect(mimoProxy.execute(rebalance.address, MIMOProxyData)).to.be.revertedWith("3");
  });
  it("it should revert if rebalance amount is too high", async () => {
    const { mimoProxy, rebalance, wmatic, priceFeed, usdc, vaultId } = await setup();
    const wmaticPrice = await priceFeed.convertFrom(wmatic.address, DEPOSIT_AMOUNT);
    const rebalanceAmount = DEPOSIT_AMOUNT;
    const mintAmount = wmaticPrice;
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: usdc.address,
      amount: rebalanceAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const rebalanceData = [
      [wmatic.address, rebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await expect(mimoProxy.execute(rebalance.address, MIMOProxyData)).to.be.reverted;
  });
});
