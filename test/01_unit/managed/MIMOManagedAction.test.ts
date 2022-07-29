import chai, { expect } from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { keccak256 } from "ethers/lib/utils";
import { artifacts, deployments, ethers } from "hardhat";
import { MIMOManagedAction, MIMOProxyRegistry } from "../../../typechain";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy"]);
  const { deploy } = deployments;
  const [owner, manager] = await ethers.getSigners();

  // Get artifacts
  const [addressProviderArtifact, accessControllerArtifact, vaultsDataProviderArtifact] = await Promise.all([
    artifacts.readArtifact("IAddressProvider"),
    artifacts.readArtifact("IAccessController"),
    artifacts.readArtifact("IVaultsDataProvider"),
  ]);

  // Deploy mock contracts
  const [addressProvider, accessController, vaultsDataProvider] = await Promise.all([
    deployMockContract(owner, addressProviderArtifact.abi),
    deployMockContract(owner, accessControllerArtifact.abi),
    deployMockContract(owner, vaultsDataProviderArtifact.abi),
  ]);

  // Deploy and fetch non mock contracts
  const proxyRegistry: MIMOProxyRegistry = await ethers.getContract("MIMOProxyRegistry");

  await deploy("MIMOManagedAction", {
    from: owner.address,
    args: [addressProvider.address, proxyRegistry.address],
  });
  const managedAction: MIMOManagedAction = await ethers.getContract("MIMOManagedAction");

  await proxyRegistry.deploy();
  const mimoProxyAddress = await proxyRegistry.getCurrentProxy(owner.address);

  // Mock required function calls
  await Promise.all([
    addressProvider.mock.controller.returns(accessController.address),
    addressProvider.mock.vaultsData.returns(vaultsDataProvider.address),
    accessController.mock.MANAGER_ROLE.returns(keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))),
    accessController.mock.hasRole.returns(true),
    vaultsDataProvider.mock.vaultOwner.returns(mimoProxyAddress),
  ]);

  await managedAction.setManager(manager.address, true);

  return {
    owner,
    manager,
    addressProvider,
    accessController,
    vaultsDataProvider,
    proxyRegistry,
    managedAction,
    deploy,
    mimoProxyAddress,
  };
});

describe("--- MIMOManagedAction Unit Tests ---", () => {
  it("should initialize state variables correctly", async () => {
    const { addressProvider, proxyRegistry, managedAction } = await setup();
    const _addressProvider = await managedAction.a();
    const _proxyRegistry = await managedAction.proxyRegistry();
    expect(_addressProvider).to.be.equal(addressProvider.address);
    expect(_proxyRegistry).to.be.equal(proxyRegistry.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { addressProvider, proxyRegistry, deploy, owner } = await setup();
    await expect(
      deploy("MIMOManagedAction", {
        from: owner.address,
        args: [ethers.constants.AddressZero, proxyRegistry.address],
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
    const { managedAction, manager, mimoProxyAddress } = await setup();
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
    ).to.be.revertedWith(`CALLER_NOT_VAULT_OWNER("${ethers.constants.AddressZero}", "${mimoProxyAddress}")`);
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
});
