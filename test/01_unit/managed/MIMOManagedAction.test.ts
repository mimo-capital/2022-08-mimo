import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { MIMOManagedAction } from "../../../typechain";
import { baseSetup } from "../baseFixture";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  const [owner, manager] = await ethers.getSigners();
  const { addressProvider, accessController, vaultsDataProvider, mimoProxyFactory, mimoProxy, deploy } =
    await baseSetup();

  await deploy("MIMOManagedAction", {
    from: owner.address,
    args: [addressProvider.address, mimoProxyFactory.address],
  });
  const managedAction: MIMOManagedAction = await ethers.getContract("MIMOManagedAction");

  await accessController.mock.hasRole.returns(true);

  await managedAction.setManager(manager.address, true);

  return {
    owner,
    manager,
    addressProvider,
    accessController,
    vaultsDataProvider,
    mimoProxyFactory,
    managedAction,
    deploy,
    mimoProxy,
  };
});

describe("--- MIMOManagedAction Unit Tests ---", () => {
  it("should initialize state variables correctly", async () => {
    const { addressProvider, mimoProxyFactory, managedAction } = await setup();
    const _addressProvider = await managedAction.a();
    const _proxyRegistry = await managedAction.proxyFactory();
    expect(_addressProvider).to.be.equal(addressProvider.address);
    expect(_proxyRegistry).to.be.equal(mimoProxyFactory.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { addressProvider, mimoProxyFactory, deploy, owner } = await setup();
    await expect(
      deploy("MIMOManagedAction", {
        from: owner.address,
        args: [ethers.constants.AddressZero, mimoProxyFactory.address],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOManagedAction", {
        from: owner.address,
        args: [addressProvider.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should be able to set manager correctly", async () => {
    const { managedAction, manager } = await setup();
    await expect(managedAction.setManager(manager.address, true))
      .to.emit(managedAction, "ManagerSet")
      .withArgs(manager.address, true);
    const isManager = await managedAction.getManager(manager.address);
    expect(isManager).to.be.true;
  });
  it("should revert if trying to set manager by other than proctocol manager", async () => {
    const { managedAction, accessController, manager } = await setup();
    await accessController.mock.hasRole.returns(false);
    await expect(managedAction.setManager(manager.address, true)).to.be.revertedWith("CALLER_NOT_PROTOCOL_MANAGER()");
  });
  it("should be able to setManagement correctly", async () => {
    const { managedAction, manager } = await setup();
    const tx = await managedAction.setManagement(1, {
      isManaged: true,
      manager: manager.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: 0,
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    const managedVault = await managedAction.getManagedVault(1);
    expect(managedVault.isManaged).to.be.true;
    expect(managedVault.manager).to.be.equal(manager.address);
    expect(managedVault.allowedVariation).to.be.equal(ethers.utils.parseUnits("1", 16));
    expect(managedVault.minRatio).to.be.equal(ethers.utils.parseUnits("150", 16));
    expect(managedVault.fixedFee).to.be.equal(ethers.constants.Zero);
    expect(managedVault.varFee).to.be.equal(ethers.constants.Zero);
    expect(tx)
      .to.emit(managedAction, "ManagementSet")
      .withArgs(1, [true, manager.address, ethers.utils.parseUnits("1", 16), ethers.utils.parseUnits("150", 16), 0, 0]);
  });
  it("should revert if trying to setManagement by other than proxy owner", async () => {
    const { managedAction, manager, mimoProxy } = await setup();
    await expect(
      managedAction.connect(manager).setManagement(1, {
        isManaged: true,
        manager: manager.address,
        allowedVariation: ethers.utils.parseUnits("1", 16),
        minRatio: ethers.utils.parseUnits("150", 16),
        fixedFee: 0,
        varFee: 0,
        mcrBuffer: ethers.utils.parseUnits("10", 16),
      }),
    ).to.be.revertedWith(`CALLER_NOT_VAULT_OWNER("${ethers.constants.AddressZero}", "${mimoProxy.address}")`);
  });
  it("should revert if trying to set manager to unlisted manager", async () => {
    const { managedAction, owner } = await setup();
    await expect(
      managedAction.setManagement(1, {
        isManaged: true,
        manager: owner.address,
        allowedVariation: ethers.utils.parseUnits("1", 16),
        minRatio: ethers.utils.parseUnits("150", 16),
        fixedFee: 0,
        varFee: 0,
        mcrBuffer: ethers.utils.parseUnits("10", 16),
      }),
    ).to.be.revertedWith(`MANAGER_NOT_LISTED()`);
  });
  it("should revert if trying to set management on uninitialized vault", async () => {
    const { managedAction, manager, vaultsDataProvider } = await setup();
    await vaultsDataProvider.mock.vaultOwner.returns(ethers.constants.AddressZero);
    await expect(
      managedAction.setManagement(1, {
        isManaged: true,
        manager: manager.address,
        allowedVariation: ethers.utils.parseUnits("1", 16),
        minRatio: ethers.utils.parseUnits("150", 16),
        fixedFee: 0,
        varFee: 0,
        mcrBuffer: ethers.utils.parseUnits("10", 16),
      }),
    ).to.be.revertedWith(`VAULT_NOT_INITIALIZED(1)`);
  });
});
