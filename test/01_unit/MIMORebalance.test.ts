import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers } from "hardhat";
import { getSelector } from "../utils";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");
const DELEVERAGE_AMOUNT = DEPOSIT_AMOUNT.mul(75).div(100);

export const setup = deployments.createFixture(async () => {
  const {
    owner,
    addressProvider,
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    dexAddressProvider,
    usdc,
    mimoProxy,
    mimoProxyFactory,
    mimoProxyGuard,
    mimoRebalance,
    lendingPool,
    data,
  } = await baseSetup();

  // Set permission on deployed MIMOProxy to allow MIMORebalance callback
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

  // Mock required function calls
  await Promise.all([
    wmatic.mock.transfer.returns(true),
    wmatic.mock.approve.returns(true),
    wmatic.mock.allowance.returns(DELEVERAGE_AMOUNT),
    wmatic.mock.balanceOf.withArgs(mimoRebalance.address).returns(DELEVERAGE_AMOUNT),
    dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    ),
    usdc.mock.balanceOf.withArgs(mimoProxy.address).returns(5000000),
    usdc.mock.approve.returns(true),
    usdc.mock.allowance.withArgs(mimoProxy.address, vaultsCore.address).returns(5000000),
    vaultsCore.mock.depositAndBorrow.returns(),
    vaultsCore.mock.repay.returns(),
    vaultsCore.mock.withdraw.returns(),
    addressProvider.mock.stablex.returns(stablex.address),
    addressProvider.mock.core.returns(vaultsCore.address),
    addressProvider.mock.vaultsData.returns(vaultsDataProvider.address),
    vaultsDataProvider.mock.vaultCollateralBalance.withArgs(1).returns(DELEVERAGE_AMOUNT),
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
    mimoRebalance,
    priceFeed,
    stablex,
    data,
    usdc,
  };
});

describe("--- MIMORebalance Unit Tests ---", () => {
  it("should initialize state variables correctly", async () => {
    const { mimoProxyFactory, mimoRebalance } = await setup();
    const _mimoProxyFactory = await mimoRebalance.proxyFactory();
    expect(_mimoProxyFactory).to.be.equal(mimoProxyFactory.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { owner, addressProvider, dexAddressProvider, lendingPool } = await setup();
    const { deploy } = deployments;
    await expect(
      deploy("MIMORebalance", {
        from: owner.address,
        args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should be able to mimoRebalance", async () => {
    const { mimoProxy, mimoRebalance, wmatic, owner, lendingPool, data, usdc } = await setup();
    const rebalanceData = [
      [wmatic.address, mimoRebalance.address, DELEVERAGE_AMOUNT],
      [usdc.address, 1, ethers.utils.parseEther("5")], // Aribitrary because mock
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await mimoProxy.execute(mimoRebalance.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [owner.address, [usdc.address, 1, DELEVERAGE_AMOUNT], [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      mimoRebalance.address,
      [wmatic.address],
      [DELEVERAGE_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should revert if initiator is not mimoProxy", async () => {
    const { mimoProxy, mimoRebalance, wmatic, owner, lendingPool, data, usdc } = await setup();
    const rebalanceData = [
      [wmatic.address, mimoRebalance.address, DELEVERAGE_AMOUNT],
      [usdc.address, 1, ethers.utils.parseEther("5")],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await mimoProxy.execute(mimoRebalance.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [owner.address, [usdc.address, 1, DELEVERAGE_AMOUNT], [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(
        mimoRebalance.address,
        [wmatic.address],
        [DELEVERAGE_AMOUNT],
        [0],
        owner.address,
        params,
      ),
    ).to.be.revertedWith(`INITIATOR_NOT_AUTHORIZED("${owner.address}", "${mimoProxy.address}")`);
  });
  it("should revert if executeOperation called by other than lending pool", async () => {
    const { mimoProxy, mimoRebalance, wmatic, owner, data, usdc, lendingPool } = await setup();
    const rebalanceData = [
      [wmatic.address, mimoRebalance.address, DELEVERAGE_AMOUNT],
      [usdc.address, 1, ethers.utils.parseEther("5")],
      [1, data.tx.data],
    ];
    const MIMOProxyData = mimoRebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await mimoProxy.execute(mimoRebalance.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [owner.address, [usdc.address, 1, DELEVERAGE_AMOUNT], [1, data.tx.data]],
    );
    await expect(
      mimoRebalance.executeOperation([wmatic.address], [DELEVERAGE_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith(`CALLER_NOT_LENDING_POOL("${owner.address}", "${lendingPool.address}")`);
  });
});
