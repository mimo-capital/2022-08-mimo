import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { MIMOProxyGuard } from "../../../typechain";
import { getSelector } from "../../utils";
import { baseSetup } from "../baseFixture";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  const { mimoVaultActions, wmatic, mimoProxyFactory, mimoProxy, mimoProxyGuard, mimoProxyActions } = await baseSetup();
  const { deploy } = deployments;
  const [owner, alice, bob] = await ethers.getSigners();

  return {
    owner,
    alice,
    bob,
    mimoProxy,
    mimoProxyFactory,
    mimoProxyGuard,
    mimoProxyActions,
    mimoVaultActions,
    wmatic,
    deploy,
  };
});

describe("--- MIMOProxyGuard Unit Tests ---", () => {
  it("should initialize state variable correctly", async () => {
    const { mimoProxyGuard, mimoProxy, mimoProxyFactory } = await setup();
    const _mimoProxy = await mimoProxyGuard.getProxy();
    const _mimoProxyFactory = await mimoProxyGuard.getProxyFactory();
    expect(_mimoProxy).to.be.equal(mimoProxy.address);
    expect(_mimoProxyFactory).to.be.equal(mimoProxyFactory.address);
  });
  it("should revert if trying to initialize state variables to address zero", async () => {
    const { deploy, mimoProxy, mimoProxyFactory, owner } = await setup();
    const newMimoProxyGuard = await deploy("MIMOProxyGuard", {
      from: owner.address,
      skipIfAlreadyDeployed: false,
    });
    const mimoProxyGuard: MIMOProxyGuard = await ethers.getContractAt("MIMOProxyGuard", newMimoProxyGuard.address);
    await expect(mimoProxyGuard.initialize(ethers.constants.AddressZero, mimoProxy.address)).to.be.revertedWith(
      "CANNOT_SET_TO_ADDRESS_ZERO()",
    );
    await expect(mimoProxyGuard.initialize(mimoProxyFactory.address, ethers.constants.AddressZero)).to.be.revertedWith(
      "CANNOT_SET_TO_ADDRESS_ZERO()",
    );
  });
  it("should be able to set permission by owner", async () => {
    const { mimoProxyGuard, mimoProxy, alice } = await setup();
    const executeSelector = getSelector(mimoProxy.interface.functions["execute(address,bytes)"].format());
    const tx = await mimoProxyGuard.setPermission(alice.address, mimoProxy.address, executeSelector, true);
    const permission = await mimoProxyGuard.getPermission(alice.address, mimoProxy.address, executeSelector);
    expect(permission).to.be.true;
    await expect(tx)
      .to.emit(mimoProxyGuard, "PermissionSet")
      .withArgs(alice.address, mimoProxy.address, executeSelector, true);
  });
  it("should be able to set permission from MIMOProxy", async () => {
    const { mimoProxyGuard, mimoProxy, alice, mimoProxyActions } = await setup();
    const executeSelector = getSelector(mimoProxy.interface.functions["execute(address,bytes)"].format());
    await mimoProxy.execute(
      mimoProxyActions.address,
      mimoProxyActions.interface.encodeFunctionData("multicall", [
        [mimoProxyGuard.address],
        [
          mimoProxyGuard.interface.encodeFunctionData("setPermission", [
            alice.address,
            mimoProxy.address,
            executeSelector,
            true,
          ]),
        ],
      ]),
    );
    const permission = await mimoProxyGuard.getPermission(alice.address, mimoProxy.address, executeSelector);
    expect(permission).to.be.true;
  });
  it("should revert if trying to set permission by other than owner or mimoProxy", async () => {
    const { mimoProxyGuard, mimoProxy, alice } = await setup();
    const executeSelector = getSelector(mimoProxy.interface.functions["execute(address,bytes)"].format());
    await expect(
      mimoProxyGuard.connect(alice).setPermission(alice.address, mimoProxy.address, executeSelector, true),
    ).to.be.revertedWith("UNAUTHORIZED_CALLER()");
  });
});
