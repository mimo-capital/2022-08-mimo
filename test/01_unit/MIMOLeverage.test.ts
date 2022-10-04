import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers } from "hardhat";
import { getSelector } from "../utils";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");
const BORROW_AMOUNT = ethers.utils.parseEther("10");
const PAR_TO_SELL = ethers.utils.parseEther("5");

const setup = deployments.createFixture(async () => {
  const {
    owner,
    addressProvider,
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    dexAddressProvider,
    mimoProxyGuard,
    mimoLeverage,
    mimoProxy,
    lendingPool,
    mimoProxyFactory,
    data,
  } = await baseSetup();

  // Set permission on deployed MIMOProxy to allow MIMOLeverage callback
  await mimoProxyGuard.setPermission(
    mimoLeverage.address,
    mimoLeverage.address,
    getSelector(
      mimoLeverage.interface.functions["leverageOperation(address,uint256,uint256,(uint256,bytes))"].format(),
    ),
    true,
  );

  // Mock required function calls
  await Promise.all([
    wmatic.mock.allowance.returns(BORROW_AMOUNT),
    wmatic.mock.approve.returns(true),
    wmatic.mock.transfer.returns(true),
    wmatic.mock.transferFrom.returns(true),
    wmatic.mock.balanceOf.withArgs(mimoProxy.address).returns(BORROW_AMOUNT),
    wmatic.mock.balanceOf.withArgs(mimoLeverage.address).returns(BORROW_AMOUNT),
    vaultsCore.mock.depositAndBorrow.returns(),
    dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    ),
    stablex.mock.allowance.returns(PAR_TO_SELL),
    stablex.mock.approve.returns(true),
    vaultsCore.mock.depositAndBorrow.returns(),
    vaultsCore.mock.deposit.returns(),
  ]);

  return {
    owner,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    wmatic,
    addressProvider,
    dexAddressProvider,
    mimoProxyFactory,
    lendingPool,
    mimoLeverage,
    priceFeed,
    stablex,
    data,
  };
});

describe("--- MIMOLeverage Unit Test ---", () => {
  it("should initialize state variables correctly", async () => {
    const { mimoProxyFactory, mimoLeverage } = await setup();
    const _mimoProxyFactory = await mimoLeverage.proxyFactory();
    expect(_mimoProxyFactory).to.be.equal(mimoProxyFactory.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { owner, addressProvider, dexAddressProvider, lendingPool } = await setup();
    const { deploy } = deployments;
    await expect(
      deploy("MIMOLeverage", {
        from: owner.address,
        args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should be able to mimoLeverage with deposit", async () => {
    const { mimoProxy, mimoLeverage, wmatic, owner, lendingPool, data } = await setup();
    const leverageData = [
      DEPOSIT_AMOUNT,
      PAR_TO_SELL,
      [wmatic.address, mimoLeverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(mimoLeverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      mimoLeverage.address,
      [wmatic.address],
      [BORROW_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should be able to mimoLeverage without deposit", async () => {
    const { mimoProxy, mimoLeverage, wmatic, owner, lendingPool, data } = await setup();
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, mimoLeverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(mimoLeverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      mimoLeverage.address,
      [wmatic.address],
      [BORROW_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should revert if collateralBalance < flashloanAmount", async () => {
    const { mimoProxy, mimoLeverage, wmatic, owner, lendingPool, data } = await setup();
    await wmatic.mock.balanceOf.withArgs(mimoProxy.address).returns(0);
    const leverageData = [
      DEPOSIT_AMOUNT,
      PAR_TO_SELL,
      [wmatic.address, mimoLeverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(mimoLeverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(
        mimoLeverage.address,
        [wmatic.address],
        [BORROW_AMOUNT],
        [0],
        mimoProxy.address,
        params,
      ),
    ).to.be.reverted;
    await expect(
      mimoLeverage.leverageOperation(wmatic.address, BORROW_AMOUNT, BORROW_AMOUNT.mul(2), {
        dexIndex: ethers.constants.One,
        dexTxData: [],
      }),
    ).to.be.revertedWith("CANNOT_REPAY_FLASHLOAN()");
  });
  it("should deposit remainingBalance in vault", async () => {
    const { mimoProxy, mimoLeverage, wmatic, owner, lendingPool, data } = await setup();
    await wmatic.mock.balanceOf.withArgs(mimoProxy.address).returns(BORROW_AMOUNT.mul(2));
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, mimoLeverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(mimoLeverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      mimoLeverage.address,
      [wmatic.address],
      [BORROW_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should revert if proxy or router address is address zero", async () => {
    const { mimoProxy, mimoLeverage, wmatic, owner, lendingPool, data, dexAddressProvider } = await setup();
    await dexAddressProvider.mock.getDex.returns(
      ethers.constants.AddressZero,
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    );
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, mimoLeverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(mimoLeverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(
        mimoLeverage.address,
        [wmatic.address],
        [BORROW_AMOUNT],
        [0],
        mimoProxy.address,
        params,
      ),
    ).to.be.reverted;
    await dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      ethers.constants.AddressZero,
    );
    await expect(
      lendingPool.executeOperation(
        mimoLeverage.address,
        [wmatic.address],
        [BORROW_AMOUNT],
        [0],
        mimoProxy.address,
        params,
      ),
    ).to.be.reverted;
    await expect(
      mimoLeverage.leverageOperation(wmatic.address, BORROW_AMOUNT, BORROW_AMOUNT, {
        dexIndex: ethers.constants.Zero,
        dexTxData: [],
      }),
    ).to.be.revertedWith("INVALID_AGGREGATOR()");
  });
  it("should revert if initiator is not mimoProxy", async () => {
    const { mimoProxy, mimoLeverage, wmatic, owner, lendingPool, data } = await setup();
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, mimoLeverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(mimoLeverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(mimoLeverage.address, [wmatic.address], [BORROW_AMOUNT], [0], owner.address, params),
    ).to.be.revertedWith(`INITIATOR_NOT_AUTHORIZED("${owner.address}", "${mimoProxy.address}")`);
  });
  it("should revert if executeOperation is called by other than lending pool", async () => {
    const { mimoProxy, mimoLeverage, wmatic, owner, data, lendingPool } = await setup();
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, mimoLeverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = mimoLeverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(mimoLeverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await expect(
      mimoLeverage.executeOperation([wmatic.address], [BORROW_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith(`CALLER_NOT_LENDING_POOL("${owner.address}", "${lendingPool.address}")`);
  });
  it("should revert if paused", async () => {
    const { mimoProxy, mimoLeverage, wmatic } = await setup();
    await mimoLeverage.pause();

    await expect(mimoLeverage.executeAction([])).to.be.revertedWith("PAUSED()");
    await expect(mimoLeverage.executeOperation([wmatic.address], [10], [0], mimoProxy.address, [])).to.be.revertedWith(
      "PAUSED()",
    );
    await expect(
      mimoLeverage.leverageOperation(wmatic.address, 10, 10, { dexIndex: 1, dexTxData: [] }),
    ).to.be.revertedWith("PAUSED()");
  });
});
