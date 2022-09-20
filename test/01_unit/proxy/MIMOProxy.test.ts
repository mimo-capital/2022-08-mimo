import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { CollisionAttacker, MIMOProxy, MIMOProxyActions, MIMOProxyFactory } from "../../../typechain";
import { getSelector } from "../../utils";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy", "MIMOProxyActions"]);
  const { deploy } = deployments;
  const [owner, alice] = await ethers.getSigners();
  const proxyFactory: MIMOProxyFactory = await ethers.getContract("MIMOProxyFactory");
  await proxyFactory.deploy();
  const mimoProxyAddress = await proxyFactory.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", mimoProxyAddress);
  const mimoProxyActions: MIMOProxyActions = await ethers.getContract("MIMOProxyActions");

  await deploy("CollisionAttacker", {
    from: owner.address,
    args: [],
  });

  const attacker: CollisionAttacker = await ethers.getContract("CollisionAttacker");

  return {
    deploy,
    owner,
    alice,
    proxyFactory,
    mimoProxy,
    attacker,
    mimoProxyActions,
  };
});

describe("--- MIMOProxy Unit Tests ---", () => {
  it("should be able to withdraw ETH from proxy", async () => {
    const { mimoProxy, owner, alice, mimoProxyActions } = await setup();
    const ownerBalanceBefore = await owner.getBalance();
    const aliceBalanceBefore = await alice.getBalance();
    const mimoProxyBalanceBefore = await ethers.provider.getBalance(mimoProxy.address);
    await alice.sendTransaction({ to: mimoProxy.address, value: ethers.utils.parseEther("10") });
    await mimoProxy.execute(mimoProxyActions.address, mimoProxyActions.interface.encodeFunctionData("withdrawETH"));
    const ownerBalanceAfter = await owner.getBalance();
    const aliceBalanceAfter = await alice.getBalance();
    const mimoProxyBalanceAfter = await ethers.provider.getBalance(mimoProxy.address);
    expect(Number(ownerBalanceAfter.sub(ownerBalanceBefore))).to.be.closeTo(1e19, 1e14);
    expect(Number(aliceBalanceBefore.sub(aliceBalanceAfter))).to.be.closeTo(1e19, 1e14);
    expect(mimoProxyBalanceBefore).to.be.equal(ethers.constants.Zero);
    expect(mimoProxyBalanceAfter).to.be.equal(ethers.constants.Zero);
  });
  it("should revert if execute() called by non owner without permission", async () => {
    const { owner, alice, mimoProxy, proxyFactory } = await setup();
    const selector = getSelector(proxyFactory.interface.functions["deploy()"].format());
    await expect(
      mimoProxy.connect(alice).execute(proxyFactory.address, proxyFactory.interface.encodeFunctionData("deploy")),
    ).to.be.revertedWith(
      `EXECUTION_NOT_AUTHORIZED("${owner.address}", "${alice.address}", "${proxyFactory.address}", "${selector}")`,
    );
  });
  it("should revert if target is invalid", async () => {
    const { alice, mimoProxy, proxyFactory } = await setup();
    await expect(
      mimoProxy.execute(alice.address, proxyFactory.interface.encodeFunctionData("deploy")),
    ).to.be.revertedWith(`TARGET_INVALID("${alice.address}")`);
  });
  it("should not be able to override proxyFactory", async () => {
    const { alice, mimoProxy, attacker, proxyFactory } = await setup();
    const proxyFactoryBefore = await mimoProxy.proxyFactory();
    mimoProxy.execute(attacker.address, attacker.interface.encodeFunctionData("overrideProxyFactory", [alice.address]));
    const proxyFactoryAfter = await mimoProxy.proxyFactory();
    expect(proxyFactoryBefore).to.be.equal(proxyFactory.address);
    expect(proxyFactoryAfter).to.be.equal(proxyFactory.address);
  });
});
