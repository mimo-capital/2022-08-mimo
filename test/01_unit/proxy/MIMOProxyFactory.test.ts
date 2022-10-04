import chai, { expect } from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { artifacts, deployments, ethers } from "hardhat";
import { MIMOLeverage, MIMOProxy, MIMOProxyFactory, MIMOProxyGuard, MockLendingPool } from "../../../typechain";
import { SelfDestruct } from "../../../typechain/SelfDestruct";
import { getSelector } from "../../utils";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy"]);
  const { deploy } = deployments;
  const [owner, alice, bob] = await ethers.getSigners();
  const mimoProxyFactory: MIMOProxyFactory = await ethers.getContract("MIMOProxyFactory");
  const mimoProxyGuardBase: MIMOProxyGuard = await ethers.getContract("MIMOProxyGuard");

  const [addressProviderArtifact, dexAddressProviderArtifact] = await Promise.all([
    artifacts.readArtifact("IAddressProvider"),
    artifacts.readArtifact("IDexAddressProvider"),
  ]);

  const [addressProvider, dexAddressProvider] = await Promise.all([
    deployMockContract(owner, addressProviderArtifact.abi),
    deployMockContract(owner, dexAddressProviderArtifact.abi),
  ]);

  await deploy("MockLendingPool", {
    from: owner.address,
    args: [],
  });

  await deploy("SelfDestruct", {
    from: owner.address,
  });
  const selfDestruct: SelfDestruct = await ethers.getContract("SelfDestruct");

  const lendingPool: MockLendingPool = await ethers.getContract("MockLendingPool");
  await deploy("MIMOLeverage", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, mimoProxyFactory.address],
  });
  const leverage: MIMOLeverage = await ethers.getContract("MIMOLeverage");

  return {
    deploy,
    owner,
    alice,
    bob,
    mimoProxyFactory,
    mimoProxyGuardBase,
    leverage,
    selfDestruct,
  };
});

describe("--- MIMOProxyFactory Unit Tests ---", () => {
  it("should be able to deploy MIMOProxyFactory correctly", async () => {
    const { mimoProxyFactory, mimoProxyGuardBase } = await setup();
    const _proxyGuardBase = await mimoProxyFactory.mimoProxyGuardBase();
    expect(_proxyGuardBase).to.be.equal(mimoProxyGuardBase.address);
  });
  it("should revert if trying to set mimoProxyGuardBase to address 0", async () => {
    const { deploy, owner } = await setup();
    await expect(
      deploy("MIMOProxyFactory", {
        from: owner.address,
        args: [ethers.constants.AddressZero],
        skipIfAlreadyDeployed: false,
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should be able to deploy proxy correctly", async () => {
    const { mimoProxyFactory, owner } = await setup();
    const tx = await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", mimoProxyAddress);
    const proxyState = await mimoProxyFactory.getProxyState(mimoProxy.address);
    const _proxyFactory = await mimoProxy.proxyFactory();
    const isProxy = await mimoProxyFactory.isProxy(mimoProxyAddress);
    expect(mimoProxyAddress).to.not.be.equal(ethers.constants.AddressZero);
    expect(_proxyFactory).to.be.equal(mimoProxyFactory.address);
    expect(proxyState.owner).to.be.equal(owner.address);
    expect(proxyState.proxyGuard).to.not.be.equal(ethers.constants.AddressZero);
    expect(proxyState.minGas).to.be.equal(ethers.BigNumber.from(5000));
    expect(isProxy).to.be.true;
    await expect(tx).to.emit(mimoProxyFactory, "ProxyDeployed").withArgs(owner.address, mimoProxy.address, proxyState);
  });
  it("should revert if deployer already owns a proxy", async () => {
    const { mimoProxyFactory, owner } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    await expect(mimoProxyFactory.deploy()).to.be.revertedWith(
      `ALREADY_OWNER("${owner.address}", "${mimoProxyAddress}")`,
    );
  });
  it("should be able to transfer ownership correctly", async () => {
    const { mimoProxyFactory, owner, alice } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    const tx_0 = await mimoProxyFactory.transferOwnership(mimoProxyAddress, alice.address);
    const pendingOwnerBeforeClaim = await mimoProxyFactory.getPendingOwner(mimoProxyAddress);
    const mimoProxyStateBeforeClaim = await mimoProxyFactory.getProxyState(mimoProxyAddress);
    const tx_1 = await mimoProxyFactory.connect(alice).claimOwnership(mimoProxyAddress, false);
    const aliceProxy = await mimoProxyFactory.getCurrentProxy(alice.address);
    const pendingOwnerAfterClaim = await mimoProxyFactory.getPendingOwner(mimoProxyAddress);
    const mimoProxyStateAfterClaim = await mimoProxyFactory.getProxyState(mimoProxyAddress);
    expect(pendingOwnerBeforeClaim).to.be.equal(alice.address);
    expect(mimoProxyStateBeforeClaim.owner).to.be.equal(owner.address);
    expect(pendingOwnerAfterClaim).to.be.equal(ethers.constants.AddressZero);
    expect(mimoProxyStateAfterClaim.owner).to.be.equal(alice.address);
    expect(aliceProxy).to.be.equal(mimoProxyAddress);
    await expect(tx_0)
      .to.emit(mimoProxyFactory, "OwnershipTransferred")
      .withArgs(mimoProxyAddress, owner.address, alice.address);
    await expect(tx_1).to.emit(mimoProxyFactory, "OwnershipClaimed").withArgs(mimoProxyAddress, alice.address);
  });
  it("should revert if trying to transfer ownership to address 0", async () => {
    const { mimoProxyFactory, owner } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    await expect(mimoProxyFactory.transferOwnership(mimoProxyAddress, ethers.constants.AddressZero)).to.be.revertedWith(
      "CANNOT_SET_TO_ADDRESS_ZERO()",
    );
  });
  it("should revert if transferOwnership() is called by other than proxy owner", async () => {
    const { mimoProxyFactory, owner, alice } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    await expect(mimoProxyFactory.connect(alice).transferOwnership(mimoProxyAddress, alice.address)).to.be.revertedWith(
      `NOT_OWNER("${owner.address}", "${alice.address}")`,
    );
  });
  it("should revert if trying to transfer proxy to address who already owns a proxy", async () => {
    const { mimoProxyFactory, alice, owner } = await setup();
    await mimoProxyFactory.deploy();
    await mimoProxyFactory.connect(alice).deploy();
    const ownerProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    const aliceProxyAddress = await mimoProxyFactory.getCurrentProxy(alice.address);
    await expect(mimoProxyFactory.transferOwnership(ownerProxyAddress, alice.address)).to.be.revertedWith(
      `ALREADY_OWNER("${alice.address}", "${aliceProxyAddress}")`,
    );
  });
  it("should revert if claimOwnership() called by other than pending owner", async () => {
    const { mimoProxyFactory, owner, alice } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    await mimoProxyFactory.transferOwnership(mimoProxyAddress, alice.address);
    await expect(mimoProxyFactory.connect(owner).claimOwnership(mimoProxyAddress, false)).to.be.revertedWith(
      `CALLER_NOT_PENDING_OWNER("${owner.address}", "${alice.address}")`,
    );
  });
  it("should revert if trying to claim ownership when already owning a proxy", async () => {
    const { mimoProxyFactory, owner, alice, bob } = await setup();
    await mimoProxyFactory.deploy();
    await mimoProxyFactory.connect(alice).deploy();
    const ownerProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    const aliceProxyAddress = await mimoProxyFactory.getCurrentProxy(alice.address);
    await mimoProxyFactory.transferOwnership(ownerProxyAddress, bob.address);
    await mimoProxyFactory.connect(alice).transferOwnership(aliceProxyAddress, bob.address);
    await mimoProxyFactory.connect(bob).claimOwnership(ownerProxyAddress, false);
    await expect(mimoProxyFactory.connect(bob).claimOwnership(aliceProxyAddress, false)).to.be.revertedWith(
      `ALREADY_OWNER("${bob.address}", "${ownerProxyAddress}")`,
    );
  });
  it("should be able to claim ownership and clear permissions", async () => {
    const { mimoProxyFactory, owner, alice } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    await mimoProxyFactory.transferOwnership(mimoProxyAddress, alice.address);
    const mimoProxyStateBeforeClaim = await mimoProxyFactory.getProxyState(mimoProxyAddress);
    await mimoProxyFactory.connect(alice).claimOwnership(mimoProxyAddress, true);
    const mimoProxyStateAfterClaim = await mimoProxyFactory.getProxyState(mimoProxyAddress);
    expect(mimoProxyStateAfterClaim.proxyGuard).to.not.be.equal(mimoProxyStateBeforeClaim.proxyGuard);
  });
  it("should be able to clear permissions", async () => {
    const { mimoProxyFactory, owner, leverage } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    const mimoProxyStateBeforeClear = await mimoProxyFactory.getProxyState(mimoProxyAddress);
    const mimoProxyGuard: MIMOProxyGuard = await ethers.getContractAt(
      "MIMOProxyGuard",
      mimoProxyStateBeforeClear.proxyGuard,
    );
    const selector = getSelector(
      leverage.interface.functions["leverageOperation(address,uint256,uint256,(uint256,bytes))"].format(),
    );
    await mimoProxyGuard.setPermission(leverage.address, leverage.address, selector, true);
    const permissionBeforeClear = await mimoProxyGuard.getPermission(leverage.address, leverage.address, selector);
    const tx = await mimoProxyFactory.clearPermissions(mimoProxyAddress);
    const mimoProxyStateAfterClear = await mimoProxyFactory.getProxyState(mimoProxyAddress);
    const newProxyGuard: MIMOProxyGuard = await ethers.getContractAt(
      "MIMOProxyGuard",
      mimoProxyStateAfterClear.proxyGuard,
    );
    const permissionAfterClear = await newProxyGuard.getPermission(leverage.address, leverage.address, selector);
    expect(permissionBeforeClear).to.be.true;
    expect(mimoProxyStateBeforeClear.proxyGuard).to.not.be.equal(mimoProxyStateAfterClear.proxyGuard);
    expect(permissionAfterClear).to.be.false;
    await expect(tx)
      .to.emit(mimoProxyFactory, "PermissionsCleared")
      .withArgs(mimoProxyAddress, mimoProxyStateAfterClear.proxyGuard);
  });
  it("should revert if clearPermission() called by other than proxy owner", async () => {
    const { mimoProxyFactory, owner, alice } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    await expect(mimoProxyFactory.connect(alice).clearPermissions(mimoProxyAddress)).to.be.revertedWith(
      `NOT_OWNER("${owner.address}", "${alice.address}")`,
    );
  });
  it("should be able to set min gas", async () => {
    const { mimoProxyFactory, owner } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    const proxyStateBefore = await mimoProxyFactory.getProxyState(mimoProxyAddress);
    const tx = await mimoProxyFactory.setMinGas(mimoProxyAddress, 4000);
    const proxyStateAfter = await mimoProxyFactory.getProxyState(mimoProxyAddress);
    expect(proxyStateBefore.minGas).to.be.equal(ethers.BigNumber.from(5000));
    expect(proxyStateAfter.minGas).to.be.equal(ethers.BigNumber.from(4000));
    await expect(tx).to.emit(mimoProxyFactory, "MinGasSet").withArgs(mimoProxyAddress, ethers.BigNumber.from(4000));
  });
  it("should revert if setMinGas() called by other than proxy owner", async () => {
    const { mimoProxyFactory, owner, alice } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    await expect(mimoProxyFactory.connect(alice).setMinGas(mimoProxyAddress, 4000)).to.be.revertedWith(
      `NOT_OWNER("${owner.address}", "${alice.address}")`,
    );
  });
  it("should be able to deploy new proxy after self destruct", async () => {
    const { mimoProxyFactory, selfDestruct, owner } = await setup();
    await mimoProxyFactory.deploy();
    const mimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", mimoProxyAddress);
    await mimoProxy.execute(
      selfDestruct.address,
      selfDestruct.interface.encodeFunctionData("selfDestruct", [owner.address]),
    );
    await mimoProxyFactory.deploy();
    const newMimoProxyAddress = await mimoProxyFactory.getCurrentProxy(owner.address);
    const newMimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", newMimoProxyAddress);
    const oldProxyState = await mimoProxyFactory.getProxyState(mimoProxy.address);
    const newProxyState = await mimoProxyFactory.getProxyState(newMimoProxy.address);
    expect(oldProxyState.owner).to.be.equal(ethers.constants.AddressZero);
    expect(oldProxyState.proxyGuard).to.be.equal(ethers.constants.AddressZero);
    expect(oldProxyState.minGas).to.be.equal(ethers.constants.Zero);
    expect(newProxyState.owner).to.be.equal(owner.address);
    expect(newProxyState.proxyGuard).to.not.be.equal(ethers.constants.AddressZero);
    expect(newProxyState.minGas).to.be.equal(ethers.BigNumber.from(5000));
  });
});
