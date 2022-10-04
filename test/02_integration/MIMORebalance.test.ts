import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers } from "hardhat";
import { getOneInchTxData, getParaswapPriceRoute, getParaswapTxData, getSelector, OneInchSwapParams } from "../utils";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");

const setup = deployments.createFixture(async () => {
  const {
    owner,
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    mimoProxyGuard,
    mimoVaultActions,
    mimoRebalance,
    mimoProxyActions,
    mimoProxy,
    premium,
  } = await baseSetup();

  // Set permission on deployed MIMOProxy for MIMORebalance callback
  await mimoProxyGuard.setPermission(
    mimoRebalance.address,
    mimoRebalance.address,
    getSelector(
      mimoRebalance.interface.functions[
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
      ].format(),
    ),
    true,
  );

  // Get WMATIC
  await wmatic.deposit({ value: DEPOSIT_AMOUNT });
  await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);

  // Create vault to be rebalanced
  const depositData = mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]);
  await mimoProxy.execute(mimoVaultActions.address, depositData);
  const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);

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
    mimoProxyGuard,
    mimoProxyActions,
    premium,
  };
});

describe("--- MIMORebalance Integration Tests ---", function () {
  this.retries(5);
  it("should be able to mimoRebalance with 1inch", async () => {
    const { mimoProxy, mimoRebalance, wmatic, priceFeed, usdc, vaultId, vaultsDataProvider } = await setup();
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
      [wmatic.address, mimoRebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(mimoRebalance.address, MIMOProxyData);
    const receipt = await tx.wait(1);
    console.log("mimoRebalance gas used with 1inch : ", receipt.gasUsed.toString());
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVautIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVautIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 1e16);
  });
  it("should be able to mimoRebalance with paraswap", async () => {
    const { mimoProxy, mimoRebalance, wmatic, priceFeed, usdc, vaultId, vaultsDataProvider } = await setup();
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
      userAddress: mimoRebalance.address,
    };

    // We now use the paraswap API to get the best route to sell the PAR we just loaned
    const { data } = await getParaswapTxData(bodyParams);

    const rebalanceData = [
      [wmatic.address, mimoRebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [0, data.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(mimoRebalance.address, MIMOProxyData);
    const receipt = await tx.wait(1);
    console.log("mimoRebalance gas used with paraswap : ", receipt.gasUsed.toString());
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVautIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVautIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(wmaticCollateralBalanceAfter)).to.be.closeTo(Number(DEPOSIT_AMOUNT.sub(rebalanceAmount)), 1e16);
  });
  it("should be able to setPermission and mimoRebalance in 1 tx", async () => {
    const {
      mimoProxy,
      mimoRebalance,
      wmatic,
      priceFeed,
      usdc,
      vaultId,
      vaultsDataProvider,
      mimoProxyGuard,
      mimoProxyActions,
    } = await setup();
    const rebalanceSelector = getSelector(
      mimoRebalance.interface.functions[
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
      ].format(),
    );
    await mimoProxyGuard.setPermission(mimoRebalance.address, mimoRebalance.address, rebalanceSelector, false);
    const permission = await mimoProxyGuard.getPermission(
      mimoRebalance.address,
      mimoRebalance.address,
      rebalanceSelector,
    );
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
      [wmatic.address, mimoRebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const mimoProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await mimoProxy.batch(
      [
        mimoProxy.interface.encodeFunctionData("execute", [
          mimoProxyActions.address,
          mimoProxyActions.interface.encodeFunctionData("multicall", [
            [mimoProxyGuard.address],
            [
              mimoProxyGuard.interface.encodeFunctionData("setPermission", [
                mimoRebalance.address,
                mimoRebalance.address,
                rebalanceSelector,
                true,
              ]),
            ],
          ]),
        ]),
        mimoProxy.interface.encodeFunctionData("execute", [mimoRebalance.address, mimoProxyData]),
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
  it("should be able to mimoRebalance 100%", async () => {
    const { mimoProxy, mimoRebalance, wmatic, usdc, vaultId, vaultsDataProvider, premium } = await setup();
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
      [wmatic.address, mimoRebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    const usdcVautIdBefore = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    const wmaticCollateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await mimoProxy.execute(mimoRebalance.address, MIMOProxyData);
    const wmaticCollateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const usdcVautIdAfter = await vaultsDataProvider.vaultId(usdc.address, mimoProxy.address);
    expect(usdcVautIdBefore).to.be.equal(ethers.constants.Zero);
    expect(usdcVautIdAfter).to.be.gt(ethers.constants.Zero);
    expect(wmaticCollateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(wmaticCollateralBalanceAfter).to.be.equal(ethers.constants.Zero);
  });
  it("it should revert if flashloan cannot be repaid", async () => {
    const { mimoProxy, mimoRebalance, wmatic, priceFeed, usdc, vaultId } = await setup();
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
      [wmatic.address, mimoRebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await expect(mimoProxy.execute(mimoRebalance.address, MIMOProxyData)).to.be.reverted;
  });
  it("it should revert if mimoRebalance amount is too high", async () => {
    const { mimoProxy, mimoRebalance, wmatic, priceFeed, usdc, vaultId } = await setup();
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
      [wmatic.address, mimoRebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await expect(mimoProxy.execute(mimoRebalance.address, MIMOProxyData)).to.be.reverted;
  });
  it("should revert if paused", async () => {
    const { mimoProxy, mimoRebalance, wmatic, priceFeed, usdc, vaultId } = await setup();
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
      [wmatic.address, mimoRebalance.address, rebalanceAmount],
      [usdc.address, vaultId, mintAmount],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await mimoRebalance.pause();

    // Cannot use revertedWith as custom error message bubble up in low level call not supported by hardhat
    await expect(mimoProxy.execute(mimoRebalance.address, MIMOProxyData)).to.be.reverted;
  });
});
