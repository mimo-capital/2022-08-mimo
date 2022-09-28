import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers } from "hardhat";
import { getSelector } from "../utils";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const FL_AMOUNT = ethers.utils.parseEther("10"); // Arbitrary because mock

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
    lendingPool,
    mimoProxyGuard,
    mimoEmptyVault,
    mimoProxy,
    mimoProxyFactory,
    data,
  } = await baseSetup();

  // Set permission on deployed MIMOProxy to allow MIMOEmptyVault callback
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

  // Mock required function calls
  await Promise.all([
    wmatic.mock.transfer.returns(true),
    wmatic.mock.approve.returns(true),
    wmatic.mock.allowance.returns(FL_AMOUNT),
    wmatic.mock.balanceOf.withArgs(mimoEmptyVault.address).returns(FL_AMOUNT),
    dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    ),
    vaultsCore.mock.repayAll.returns(),
    vaultsCore.mock.withdraw.returns(),
    addressProvider.mock.stablex.returns(stablex.address),
    addressProvider.mock.core.returns(vaultsCore.address),
    vaultsDataProvider.mock.vaultCollateralBalance.returns(FL_AMOUNT),
    stablex.mock.approve.returns(true),
    stablex.mock.allowance.returns(FL_AMOUNT),
    stablex.mock.balanceOf.withArgs(mimoProxy.address).returns(FL_AMOUNT),
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
    mimoEmptyVault,
    priceFeed,
    stablex,
    data,
  };
});

describe("--- MIMOEmptyVault Unit Tests ---", () => {
  it("should initialize state variables correctly", async () => {
    const { lendingPool, mimoEmptyVault } = await setup();
    const _lendingPool = await mimoEmptyVault.lendingPool();
    expect(_lendingPool).to.be.equal(lendingPool.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { owner, addressProvider, dexAddressProvider, mimoProxyFactory, lendingPool } = await setup();
    const { deploy } = deployments;
    await expect(
      deploy("MIMOEmptyVault", {
        from: owner.address,
        args: [
          addressProvider.address,
          dexAddressProvider.address,
          ethers.constants.AddressZero,
          mimoProxyFactory.address,
        ],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOEmptyVault", {
        from: owner.address,
        args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should be able to mimoEmptyVault", async () => {
    const { mimoProxy, mimoEmptyVault, wmatic, owner, lendingPool, data } = await setup();
    await wmatic.mock.balanceOf.withArgs(mimoProxy.address).returns(FL_AMOUNT);
    const emptyVaultData = [1, [wmatic.address, mimoEmptyVault.address, FL_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256,bytes)"],
      [owner.address, 1, [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      mimoEmptyVault.address,
      [wmatic.address],
      [FL_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should revert if initiator is other than mimo proxy", async () => {
    const { mimoProxy, mimoEmptyVault, wmatic, owner, lendingPool, data } = await setup();
    const emptyVaultData = [1, [wmatic.address, mimoEmptyVault.address, FL_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256,bytes)"],
      [owner.address, 1, [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(mimoEmptyVault.address, [wmatic.address], [FL_AMOUNT], [0], owner.address, params),
    ).to.be.revertedWith(`INITIATOR_NOT_AUTHORIZED("${owner.address}", "${mimoProxy.address}")`);
  });
  it("should revert if executeOperation is called by other than lending pool", async () => {
    const { mimoProxy, mimoEmptyVault, wmatic, owner, data, lendingPool } = await setup();
    const emptyVaultData = [1, [wmatic.address, mimoEmptyVault.address, FL_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = mimoEmptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await mimoProxy.execute(mimoEmptyVault.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256,bytes)"],
      [owner.address, 1, [1, data.tx.data]],
    );
    await expect(
      mimoEmptyVault.executeOperation([wmatic.address], [FL_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith(`CALLER_NOT_LENDING_POOL("${owner.address}", "${lendingPool.address}")`);
  });
});
