import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers } from "hardhat";
import { getOneInchTxData, getParaswapPriceRoute, getParaswapTxData, getSelector, OneInchSwapParams } from "../utils";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");
const BORROW_AMOUNT = ethers.utils.parseEther("10");

const setup = deployments.createFixture(async () => {
  const {
    owner,
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    mimoVaultActions,
    mimoLeverage,
    mimoProxyActions,
    mimoProxyGuard,
    mimoProxy,
  } = await baseSetup();

  // Set permission on deployed MIMOProxy for MIMOLeverage callback
  await mimoProxyGuard.setPermission(
    mimoLeverage.address,
    mimoLeverage.address,
    getSelector(
      mimoLeverage.interface.functions["leverageOperation(address,uint256,uint256,(uint256,bytes))"].format(),
    ),
    true,
  );

  // Get WMATIC
  await wmatic.deposit({ value: DEPOSIT_AMOUNT });
  await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);

  return {
    owner,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    mimoVaultActions,
    wmatic,
    mimoLeverage,
    priceFeed,
    stablex,
    mimoProxyGuard,
    mimoProxyActions,
  };
});

describe("--- MIMOLeverage Integration Tests ---", function () {
  this.retries(5);
  it("should be able to mimoLeverage with deposit through 1 inch", async () => {
    const { mimoProxy, mimoLeverage, wmatic, priceFeed, stablex, vaultsDataProvider } = await setup();
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, mimoLeverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    const vaultIdBefore = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const tx = await mimoProxy.execute(mimoLeverage.address, mimoProxyData);
    const receipt = await tx.wait(1);
    console.log("mimoLeverage gas used : ", receipt.gasUsed.toString());
    const vaultIdAfter = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const collateralBalance = await vaultsDataProvider.vaultCollateralBalance(vaultIdAfter);
    expect(vaultIdBefore).to.be.equal(ethers.constants.Zero);
    expect(collateralBalance).to.be.gte(DEPOSIT_AMOUNT.add(BORROW_AMOUNT));
  });
  it("should be able to mimoLeverage without deposit through 1 inch", async () => {
    const { mimoProxy, mimoLeverage, wmatic, priceFeed, stablex, vaultsDataProvider, mimoVaultActions } = await setup();
    await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
    );
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [0, parToSell, [wmatic.address, mimoLeverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const mimoProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(mimoLeverage.address, mimoProxyData);
    const receipt = await tx.wait(1);
    console.log("mimoLeverage gas used : ", receipt.gasUsed.toString());
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.gte(DEPOSIT_AMOUNT.add(BORROW_AMOUNT));
  });
  it("should be able to mimoLeverage through paraswap", async () => {
    const { mimoProxy, mimoLeverage, wmatic, priceFeed, stablex, vaultsDataProvider } = await setup();
    await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const pricesParams = {
      srcToken: stablex.address,
      destToken: wmatic.address,
      side: "SELL",
      network: 137,
      srcDecimals: 18,
      destDecimals: 18,
      amount: parToSell.toString(),
    };

    // Call Paraswap
    const routeData = await getParaswapPriceRoute(pricesParams);

    const bodyParams = {
      srcToken: stablex.address,
      destToken: wmatic.address,
      priceRoute: routeData.data.priceRoute,
      srcAmount: parToSell.toString(),
      slippage: 100, // 1% slippage
      userAddress: mimoLeverage.address,
    };

    // We now use the paraswap API to get the best route to sell the PAR we just loaned
    const { data } = await getParaswapTxData(bodyParams);

    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, mimoLeverage.address, BORROW_AMOUNT],
      [0, data.data],
    ];
    const mimoProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    const vaultIdBefore = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const tx = await mimoProxy.execute(mimoLeverage.address, mimoProxyData);
    const receipt = await tx.wait(1);
    console.log("mimoLeverage gas used : ", receipt.gasUsed.toString());
    const vaultIdAfter = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const collateralBalance = await vaultsDataProvider.vaultCollateralBalance(vaultIdAfter);
    expect(vaultIdBefore).to.be.equal(ethers.constants.Zero);
    expect(collateralBalance).to.be.gte(DEPOSIT_AMOUNT.add(BORROW_AMOUNT));
  });
  it("should be able to setPermission and mimoLeverage in 1 tx", async () => {
    const {
      mimoProxy,
      mimoLeverage,
      wmatic,
      priceFeed,
      stablex,
      vaultsDataProvider,
      mimoProxyGuard,
      mimoProxyActions,
    } = await setup();
    const leverageSelector = getSelector(
      mimoLeverage.interface.functions["leverageOperation(address,uint256,uint256,(uint256,bytes))"].format(),
    );
    await mimoProxyGuard.setPermission(mimoLeverage.address, mimoLeverage.address, leverageSelector, false);
    const permission = await mimoProxyGuard.getPermission(mimoLeverage.address, mimoLeverage.address, leverageSelector);
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, mimoLeverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    const vaultIdBefore = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    await mimoProxy.batch(
      [
        mimoProxy.interface.encodeFunctionData("execute", [
          mimoProxyActions.address,
          mimoProxyActions.interface.encodeFunctionData("multicall", [
            [mimoProxyGuard.address],
            [
              mimoProxyGuard.interface.encodeFunctionData("setPermission", [
                mimoLeverage.address,
                mimoLeverage.address,
                leverageSelector,
                true,
              ]),
            ],
          ]),
        ]),
        mimoProxy.interface.encodeFunctionData("execute", [mimoLeverage.address, mimoProxyData]),
      ],
      true,
    );
    const vaultIdAfter = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const collateralBalance = await vaultsDataProvider.vaultCollateralBalance(vaultIdAfter);
    expect(permission).to.be.false;
    expect(vaultIdBefore).to.be.equal(ethers.constants.Zero);
    expect(collateralBalance).to.be.gte(DEPOSIT_AMOUNT.add(BORROW_AMOUNT));
  });
  it("should revert if flashloan cannot be repaid", async () => {
    const { mimoProxy, mimoLeverage, wmatic, priceFeed, stablex } = await setup();
    await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(50).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, mimoLeverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await expect(mimoProxy.execute(mimoLeverage.address, mimoProxyData)).to.be.reverted;
  });
  it("should revert if trying to mimoLeverage above MCR", async () => {
    const { mimoProxy, mimoLeverage, wmatic, priceFeed, stablex } = await setup();
    await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(201).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, mimoLeverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await expect(mimoProxy.execute(mimoLeverage.address, mimoProxyData)).to.be.reverted;
  });
  it("should revert if paused", async () => {
    const { mimoProxy, mimoLeverage, wmatic, priceFeed, stablex } = await setup();
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, mimoLeverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoLeverage.pause();

    // Cannot use revertedWith as custom error message bubble up in low level call not supported by hardhat
    await expect(mimoProxy.execute(mimoLeverage.address, mimoProxyData)).to.be.reverted;
  });
});
