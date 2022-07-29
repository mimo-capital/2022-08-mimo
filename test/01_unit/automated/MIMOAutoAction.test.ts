import chai, { expect } from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { keccak256 } from "ethers/lib/utils";
import { artifacts, deployments, ethers } from "hardhat";
import { MIMOAutoAction, MIMOProxyRegistry } from "../../../typechain";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy"]);
  const { deploy } = deployments;
  const [owner, alice] = await ethers.getSigners();

  // Get artifacts
  const [
    addressProviderArtifact,
    accessControllerArtifact,
    vaultsDataProviderArtifact,
    erc20Artifact,
    configProviderArtifact,
  ] = await Promise.all([
    artifacts.readArtifact("IAddressProvider"),
    artifacts.readArtifact("IAccessController"),
    artifacts.readArtifact("IVaultsDataProvider"),
    artifacts.readArtifact("IERC20"),
    artifacts.readArtifact("IConfigProvider"),
  ]);

  // Deploy mock contracts
  const [addressProvider, accessController, vaultsDataProvider, usdc, configProvider] = await Promise.all([
    deployMockContract(owner, addressProviderArtifact.abi),
    deployMockContract(owner, accessControllerArtifact.abi),
    deployMockContract(owner, vaultsDataProviderArtifact.abi),
    deployMockContract(owner, erc20Artifact.abi),
    deployMockContract(owner, configProviderArtifact.abi),
  ]);

  // Deploy and fetch non mock contracts
  const proxyRegistry: MIMOProxyRegistry = await ethers.getContract("MIMOProxyRegistry");

  await deploy("MIMOAutoAction", {
    from: owner.address,
    args: [addressProvider.address, proxyRegistry.address],
  });
  const autoAction: MIMOAutoAction = await ethers.getContract("MIMOAutoAction");

  await proxyRegistry.deploy();
  const mimoProxyAddress = await proxyRegistry.getCurrentProxy(owner.address);

  // Mock required function calls
  await Promise.all([
    addressProvider.mock.controller.returns(accessController.address),
    addressProvider.mock.vaultsData.returns(vaultsDataProvider.address),
    addressProvider.mock.config.returns(configProvider.address),
    accessController.mock.MANAGER_ROLE.returns(keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))),
    accessController.mock.hasRole.returns(true),
    vaultsDataProvider.mock.vaultOwner.returns(mimoProxyAddress),
    configProvider.mock.collateralMinCollateralRatio.withArgs(usdc.address).returns(ethers.utils.parseEther("1.1")),
  ]);

  return {
    owner,
    alice,
    addressProvider,
    accessController,
    vaultsDataProvider,
    proxyRegistry,
    autoAction,
    deploy,
    mimoProxyAddress,
    usdc,
  };
});

describe("--- MIMOAutoAction Unit Test ---", () => {
  it("should set state variables correctly", async () => {
    const { addressProvider, proxyRegistry, autoAction } = await setup();
    const _addressProvider = await autoAction.a();
    const _proxyRegistry = await autoAction.proxyRegistry();
    expect(_addressProvider).to.be.equal(addressProvider.address);
    expect(_proxyRegistry).to.be.equal(proxyRegistry.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { addressProvider, proxyRegistry, deploy, owner } = await setup();
    await expect(
      deploy("MIMOAutoAction", {
        from: owner.address,
        args: [ethers.constants.AddressZero, proxyRegistry.address],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOAutoAction", {
        from: owner.address,
        args: [addressProvider.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should be able to set automation correctly", async () => {
    const { autoAction, usdc } = await setup();
    await expect(
      autoAction.setAutomation(1, {
        isAutomated: true,
        toCollateral: usdc.address,
        allowedVariation: ethers.utils.parseUnits("1", 16),
        targetRatio: ethers.utils.parseUnits("150", 16),
        triggerRatio: ethers.utils.parseUnits("140", 16),
        mcrBuffer: ethers.utils.parseUnits("10", 16),
        fixedFee: 0,
        varFee: 0,
      }),
    )
      .to.emit(autoAction, "AutomationSet")
      .withArgs(1, [
        true,
        usdc.address,
        ethers.utils.parseUnits("1", 16),
        ethers.utils.parseUnits("150", 16),
        ethers.utils.parseUnits("140", 16),
        ethers.utils.parseUnits("10", 16),
        0,
        0,
      ]);
    const autoVault = await autoAction.getAutomatedVault(1);
    expect(autoVault.isAutomated).to.be.true;
    expect(autoVault.toCollateral).to.be.equal(usdc.address);
    expect(autoVault.allowedVariation).to.be.equal(ethers.utils.parseUnits("1", 16));
    expect(autoVault.targetRatio).to.be.equal(ethers.utils.parseUnits("150", 16));
    expect(autoVault.triggerRatio).to.be.equal(ethers.utils.parseUnits("140", 16));
    expect(autoVault.fixedFee).to.be.equal(ethers.constants.Zero);
    expect(autoVault.varFee).to.be.equal(ethers.constants.Zero);
  });
  it("should rever if trying to set automation by other then proxy owner", async () => {
    const { autoAction, alice, mimoProxyAddress, usdc } = await setup();
    await expect(
      autoAction.connect(alice).setAutomation(1, {
        isAutomated: true,
        toCollateral: usdc.address,
        allowedVariation: ethers.utils.parseUnits("1", 16),
        targetRatio: ethers.utils.parseUnits("150", 16),
        triggerRatio: ethers.utils.parseUnits("140", 16),
        mcrBuffer: ethers.utils.parseUnits("10", 16),
        fixedFee: 0,
        varFee: 0,
      }),
    ).to.be.revertedWith(`CALLER_NOT_VAULT_OWNER("${ethers.constants.AddressZero}", "${mimoProxyAddress}")`);
  });
});
