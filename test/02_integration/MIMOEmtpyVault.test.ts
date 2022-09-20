import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers } from "hardhat";
import {
  getOneInchTxData,
  getParaswapPriceRoute,
  getParaswapTxData,
  getSelector,
  WAD,
  OneInchSwapParams,
} from "../utils";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("50");
const BORROW_AMOUNT = ethers.utils.parseEther("5");

const setup = deployments.createFixture(async () => {
  const {
    owner,
    vaultsCore,
    vaultsDataProvider,
    accessController,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    mimoProxyGuard,
    mimoVaultActions,
    mimoEmptyVault,
    mimoProxyActions,
    mimoProxy,
    multisig,
  } = await baseSetup();

  // Set permission on deployed MIMOProxy for MIMOEmptyVault callback
  await mimoProxyGuard.setPermission(
    mimoEmptyVault.address,
    mimoEmptyVault.address,
    getSelector(
      mimoEmptyVault.interface.functions[
        "emptyVaultOperation(address,address,uint256,uint256,uint256,(uint256,bytes))"
      ].format(),
    ),
    true,
  );

  // Get WMATIC
  await wmatic.deposit({ value: DEPOSIT_AMOUNT });
  await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);

  // Open vault to be emptied
  const depositData = mimoVaultActions.interface.encodeFunctionData("depositAndBorrow", [
    wmatic.address,
    DEPOSIT_AMOUNT,
    BORROW_AMOUNT,
  ]);
  await mimoProxy.execute(mimoVaultActions.address, depositData);
  const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);

  return {
    owner,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    wmatic,
    mimoEmptyVault,
    priceFeed,
    stablex,
    usdc,
    vaultId,
    mimoVaultActions,
    accessController,
    mimoProxyGuard,
    mimoProxyActions,
    multisig,
  };
});

describe("--- MIMOEmtpyVault Integration Tests ---", function () {
  this.retries(5);
  it("should be able to empty vault with 1inch", async () => {
    const { mimoProxy, mimoEmptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, mimoEmptyVault.address, flAmount], [1, data.tx.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData);
    const receipt = await tx.wait(1);
    console.log("Empty vault 1inch gas used : ", receipt.gasUsed.toString());
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebtAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(vaultDebt).to.be.gt(ethers.constants.Zero);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.equal(ethers.constants.Zero);
    expect(vaultDebtAfter).to.be.equal(ethers.constants.Zero);
  });
  it("should be able to empty vault with paraswap", async () => {
    const { mimoProxy, mimoEmptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const pricesParams = {
      srcToken: wmatic.address,
      destToken: stablex.address,
      side: "SELL",
      network: 137,
      srcDecimals: 18,
      destDecimals: 18,
      amount: flAmount.toString(),
    };
    // Call Paraswap
    const routeData = await getParaswapPriceRoute(pricesParams);

    const bodyParams = {
      srcToken: wmatic.address,
      destToken: stablex.address,
      priceRoute: routeData.data.priceRoute,
      srcAmount: flAmount.toString(),
      slippage: 100, // 1% slippage
      userAddress: mimoProxy.address,
    };

    // We now use the paraswap API to get the best route to sell the PAR we just loaned
    const { data } = await getParaswapTxData(bodyParams);
    const emptyVaultData = [vaultId, [wmatic.address, mimoEmptyVault.address, flAmount], [0, data.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData);
    const receipt = await tx.wait(1);
    console.log("Empty vault paraswap gas used : ", receipt.gasUsed.toString());
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebtAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(vaultDebt).to.be.gt(ethers.constants.Zero);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.equal(ethers.constants.Zero);
    expect(vaultDebtAfter).to.be.equal(ethers.constants.Zero);
  });
  it("should be able to setPermission and empty vault in 1 tx", async () => {
    const {
      mimoProxy,
      mimoEmptyVault,
      wmatic,
      priceFeed,
      stablex,
      vaultId,
      vaultsDataProvider,
      mimoProxyGuard,
      mimoProxyActions,
    } = await setup();
    const emptyVaultSelector = getSelector(
      mimoEmptyVault.interface.functions[
        "emptyVaultOperation(address,address,uint256,uint256,uint256,(uint256,bytes))"
      ].format(),
    );
    await mimoProxyGuard.setPermission(mimoEmptyVault.address, mimoEmptyVault.address, emptyVaultSelector, false);
    const permission = await mimoProxyGuard.getPermission(
      mimoEmptyVault.address,
      mimoEmptyVault.address,
      emptyVaultSelector,
    );
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, mimoEmptyVault.address, flAmount], [1, data.tx.data]];
    const mimoProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await mimoProxy.batch(
      [
        mimoProxy.interface.encodeFunctionData("execute", [
          mimoProxyActions.address,
          mimoProxyActions.interface.encodeFunctionData("multicall", [
            [mimoProxyGuard.address],
            [
              mimoProxyGuard.interface.encodeFunctionData("setPermission", [
                mimoEmptyVault.address,
                mimoEmptyVault.address,
                emptyVaultSelector,
                true,
              ]),
            ],
          ]),
        ]),
        mimoProxy.interface.encodeFunctionData("execute", [mimoEmptyVault.address, mimoProxyData]),
      ],
      true,
    );
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebtAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(permission).to.be.false;
    expect(vaultDebt).to.be.gt(ethers.constants.Zero);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.equal(ethers.constants.Zero);
    expect(vaultDebtAfter).to.be.equal(ethers.constants.Zero);
  });
  it("should revert if flashloan cannot be repaid", async () => {
    const {
      mimoProxy,
      mimoEmptyVault,
      wmatic,
      priceFeed,
      stablex,
      vaultId,
      vaultsDataProvider,
      mimoVaultActions,
      vaultsCore,
      owner,
      mimoProxyActions,
    } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, mimoEmptyVault.address, flAmount], [1, data.tx.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await stablex.mint(mimoProxy.address, vaultDebt.mul(2));
    await stablex.mint(owner.address, ethers.utils.parseEther("4"));
    await stablex.approve(vaultsCore.address, ethers.utils.parseEther("4"));
    await vaultsCore.repay(vaultId, ethers.utils.parseEther("4"));
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("withdraw", [vaultId, ethers.utils.parseEther("45")]),
    );

    // Send Matic bal to owner so mimoProxy can't use it to repay loan
    const proxyWMaticBal = await wmatic.balanceOf(mimoProxy.address);
    await mimoProxy.execute(
      mimoProxyActions.address,
      mimoProxyActions.interface.encodeFunctionData("multicall", [
        [wmatic.address],
        [wmatic.interface.encodeFunctionData("transfer", [owner.address, proxyWMaticBal])],
      ]),
    );

    await expect(mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData)).to.be.reverted;
  });
  it("should revert if no enough collateral flashloaned", async () => {
    const { mimoProxy, mimoEmptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(10); // Account for slippage

    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, mimoEmptyVault.address, flAmount], [1, data.tx.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await expect(mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData)).to.be.reverted;
  });
  it("should not leave any funds in the mimoEmptyVault contracts", async () => {
    const { owner, mimoProxy, mimoEmptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const pricesParams = {
      srcToken: wmatic.address,
      destToken: stablex.address,
      side: "SELL",
      network: 137,
      srcDecimals: 18,
      destDecimals: 18,
      amount: flAmount.toString(),
    };
    // Call Paraswap
    const routeData = await getParaswapPriceRoute(pricesParams);

    const bodyParams = {
      srcToken: wmatic.address,
      destToken: stablex.address,
      priceRoute: routeData.data.priceRoute,
      srcAmount: flAmount.toString(),
      slippage: 100, // 1% slippage
      userAddress: mimoProxy.address,
    };

    // Use paraswap API to get the best route to sell the PAR we just loaned
    const { data } = await getParaswapTxData(bodyParams);
    const emptyVaultData = [vaultId, [wmatic.address, mimoEmptyVault.address, flAmount], [0, data.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const ownerParBalanceBefore = await stablex.balanceOf(owner.address);
    await mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData);
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebtAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(vaultDebt).to.be.gt(ethers.constants.Zero);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.equal(ethers.constants.Zero);
    expect(vaultDebtAfter).to.be.equal(ethers.constants.Zero);
    const emptyVaultContractAssetBalance = await wmatic.balanceOf(mimoEmptyVault.address); // All withdrawn balance should be sent to the user
    const emptyVaultContractPARBalance = await stablex.balanceOf(mimoEmptyVault.address); // All withdrawn balance should be sent to the user
    const ownerCollateralBalance = await wmatic.balanceOf(owner.address); // All withdrawn balance should be sent to the user
    const ownerParBalanceAfter = await stablex.balanceOf(owner.address); // Remaining PAR from swap should be sent to user
    expect(emptyVaultContractAssetBalance).equal(0);
    expect(emptyVaultContractPARBalance).equal(0);
    const flashLoanRepayAmount = flAmount.mul(10005).div(10000);
    expect(ownerCollateralBalance).to.be.closeTo(DEPOSIT_AMOUNT.sub(flashLoanRepayAmount), 1); // Remaining collateral balance should be sent to the owner; might be off by 1 due to rounding
    const leftOverPar = BigNumber.from(routeData.data.priceRoute.destAmount).sub(vaultDebt);
    console.log("leftOverPar local", leftOverPar.toString());
    expect(ownerParBalanceAfter.sub(ownerParBalanceBefore)).to.be.closeTo(leftOverPar, WAD.mul(3).div(100));
  });
  it("should revert if paused", async () => {
    const { mimoProxy, mimoEmptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, mimoEmptyVault.address, flAmount], [1, data.tx.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await mimoEmptyVault.pause();

    // Cannot use revertedWith as custom error message bubble up in low level call not supported by hardhat
    await expect(mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData)).to.be.reverted;
  });
});
