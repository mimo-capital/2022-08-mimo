import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import {
  CollisionAttacker,
  MIMOProxy,
  MIMOProxyActions,
  MIMOProxyFactory,
  MIMOProxyGuard,
  MockAction,
  SelectorBypass,
} from "../../../typechain";
import { getSelector } from "../../utils";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy", "MIMOProxyActions"]);
  const { deploy } = deployments;
  const [owner, alice] = await ethers.getSigners();
  const mimoProxyFactory: MIMOProxyFactory = await ethers.getContract("MIMOProxyFactory");
  await mimoProxyFactory.deploy();
  const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", mimoProxyAddress);
  const mimoProxyActions: MIMOProxyActions = await ethers.getContract("MIMOProxyActions");
  const { proxyGuard } = await mimoProxyFactory.getProxyState(mimoProxy.address);
  const mimoProxyGuard: MIMOProxyGuard = await ethers.getContractAt("MIMOProxyGuard", proxyGuard);

  await deploy("SelectorBypass", {
    from: owner.address,
    args: [mimoProxy.address],
  });

  await deploy("MockAction", {
    from: owner.address,
  });

  const selectorBypass: SelectorBypass = await ethers.getContract("SelectorBypass");
  const mockAction: MockAction = await ethers.getContract("MockAction");

  await deploy("CollisionAttacker", {
    from: owner.address,
    args: [],
  });

  const attacker: CollisionAttacker = await ethers.getContract("CollisionAttacker");

  return {
    deploy,
    owner,
    alice,
    mimoProxyFactory,
    mimoProxy,
    attacker,
    mimoProxyActions,
    mimoProxyGuard,
    selectorBypass,
    mockAction,
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
    const { owner, alice, mimoProxy, mimoProxyFactory } = await setup();
    const selector = getSelector(mimoProxyFactory.interface.functions["deploy()"].format());
    await expect(
      mimoProxy
        .connect(alice)
        .execute(mimoProxyFactory.address, mimoProxyFactory.interface.encodeFunctionData("deploy")),
    ).to.be.revertedWith(
      `EXECUTION_NOT_AUTHORIZED("${owner.address}", "${alice.address}", "${mimoProxyFactory.address}", "${selector}")`,
    );
  });
  it("should revert if target is invalid", async () => {
    const { alice, mimoProxy, mimoProxyFactory } = await setup();
    await expect(
      mimoProxy.execute(alice.address, mimoProxyFactory.interface.encodeFunctionData("deploy")),
    ).to.be.revertedWith(`TARGET_INVALID("${alice.address}")`);
  });
  it("should not be able to override mimoProxyFactory", async () => {
    const { alice, mimoProxy, attacker, mimoProxyFactory } = await setup();
    const mimoProxyFactoryBefore = await mimoProxy.proxyFactory();
    mimoProxy.execute(attacker.address, attacker.interface.encodeFunctionData("overrideProxyFactory", [alice.address]));
    const mimoProxyFactoryAfter = await mimoProxy.proxyFactory();
    expect(mimoProxyFactoryBefore).to.be.equal(mimoProxyFactory.address);
    expect(mimoProxyFactoryAfter).to.be.equal(mimoProxyFactory.address);
  });
  it("should not be able to bypass selector check", async () => {
    const { mimoProxyGuard, selectorBypass, mockAction } = await setup();
    const depositSelector = getSelector(mockAction.interface.functions["deposit()"].format());
    await mimoProxyGuard.setPermission(selectorBypass.address, mockAction.address, depositSelector, true);
    await expect(selectorBypass.exploit(mockAction.address, depositSelector)).to.be.revertedWith(
      "EXECUTION_REVERTED()",
    );
  });
});
