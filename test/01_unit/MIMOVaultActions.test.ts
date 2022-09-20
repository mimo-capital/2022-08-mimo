import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { ProxyPausable } from "../../typechain";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  const {
    owner,
    addressProvider,
    vaultsCore,
    vaultsDataProvider,
    stablex,
    mimoVaultActions,
    mimoProxyFactory,
    deploy,
  } = await baseSetup();

  return {
    owner,
    deploy,
    vaultsCore,
    vaultsDataProvider,
    addressProvider,
    stablex,
    mimoVaultActions,
    mimoProxyFactory,
  };
});

describe("--- MIMOVaultActions Unit Tests ---", () => {
  it("should set state variables correctly", async () => {
    const { vaultsCore, vaultsDataProvider, stablex, mimoVaultActions, mimoProxyFactory } = await setup();
    const core = await mimoVaultActions.core();
    const vaultsData = await mimoVaultActions.vaultsData();
    const _stablex = await mimoVaultActions.stablex();
    const contractAddress = await mimoVaultActions.contractAddress();
    const proxyFactory = await mimoVaultActions.proxyFactory();
    expect(core).to.be.equal(vaultsCore.address);
    expect(vaultsData).to.be.equal(vaultsDataProvider.address);
    expect(_stablex).to.be.equal(stablex.address);
    expect(contractAddress).to.be.equal(mimoVaultActions.address);
    expect(proxyFactory).to.be.equal(mimoProxyFactory.address);
  });
  it("should revert if trying to set state variables to adddress zero", async () => {
    const { vaultsCore, vaultsDataProvider, stablex, owner, mimoProxyFactory } = await setup();
    const { deploy } = deployments;
    await expect(
      deploy("MIMOVaultActions", {
        from: owner.address,
        args: [ethers.constants.AddressZero, vaultsDataProvider.address, stablex.address, mimoProxyFactory.address],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOVaultActions", {
        from: owner.address,
        args: [vaultsCore.address, ethers.constants.AddressZero, stablex.address, mimoProxyFactory.address],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOVaultActions", {
        from: owner.address,
        args: [vaultsCore.address, vaultsDataProvider.address, ethers.constants.AddressZero, mimoProxyFactory.address],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOVaultActions", {
        from: owner.address,
        args: [vaultsCore.address, vaultsDataProvider.address, stablex.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should not be able to bypass paused state with different proxy", async () => {
    const { deploy, mimoVaultActions, owner } = await setup();
    await deploy("ProxyPausable", {
      from: owner.address,
    });
    const proxyPausable: ProxyPausable = await ethers.getContract("ProxyPausable");
    await mimoVaultActions.pause();
    const proxyPausablePaused = await proxyPausable.paused();
    const vaultActionsPaused = await mimoVaultActions.paused();
    expect(proxyPausablePaused).to.be.false;
    expect(vaultActionsPaused).to.be.true;
    await expect(
      proxyPausable.execute(mimoVaultActions.address, mimoVaultActions.interface.encodeFunctionData("depositETH"), {
        value: ethers.utils.parseEther("10"),
      }),
    ).to.be.reverted;
  });
});
