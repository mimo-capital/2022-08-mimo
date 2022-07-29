import chai, { expect } from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { artifacts, deployments, ethers } from "hardhat";
import { MIMOVaultActions } from "../../typechain";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy"]);
  const { deploy } = deployments;
  const [owner] = await ethers.getSigners();

  // Get artifacts
  const [addressProviderArtifact, vaultsCoreArtifact, vaultsDataProviderArtifact, stablexArtifact] = await Promise.all([
    artifacts.readArtifact("IAddressProvider"),
    artifacts.readArtifact("IVaultsCore"),
    artifacts.readArtifact("IVaultsDataProvider"),
    artifacts.readArtifact("IPriceFeed"),
    artifacts.readArtifact("ISTABLEX"),
    artifacts.readArtifact("IWETH"),
    artifacts.readArtifact("IDexAddressProvider"),
  ]);

  // Deploy mock contracts
  const [addressProvider, vaultsCore, vaultsDataProvider, stablex] = await Promise.all([
    deployMockContract(owner, addressProviderArtifact.abi),
    deployMockContract(owner, vaultsCoreArtifact.abi),
    deployMockContract(owner, vaultsDataProviderArtifact.abi),
    deployMockContract(owner, stablexArtifact.abi),
  ]);

  // Deploy and fetch non mock contracts
  await deploy("MIMOVaultActions", {
    from: owner.address,
    args: [vaultsCore.address, vaultsDataProvider.address, stablex.address],
  });
  const vaultActions: MIMOVaultActions = await ethers.getContract("MIMOVaultActions");

  return {
    owner,
    vaultsCore,
    vaultsDataProvider,
    addressProvider,
    stablex,
    vaultActions,
  };
});

describe("--- MIMOVaultActions Unit Tests ---", () => {
  it("should set state variables correctly", async () => {
    const { vaultsCore, vaultsDataProvider, stablex, vaultActions } = await setup();
    const core = await vaultActions.core();
    const vaultsData = await vaultActions.vaultsData();
    const _stablex = await vaultActions.stablex();
    expect(core).to.be.equal(vaultsCore.address);
    expect(vaultsData).to.be.equal(vaultsDataProvider.address);
    expect(_stablex).to.be.equal(stablex.address);
  });
  it("should revert if trying to set state variables to adddress zero", async () => {
    const { vaultsCore, vaultsDataProvider, stablex, owner } = await setup();
    const { deploy } = deployments;
    await expect(
      deploy("MIMOVaultActions", {
        from: owner.address,
        args: [ethers.constants.AddressZero, vaultsDataProvider.address, stablex.address],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOVaultActions", {
        from: owner.address,
        args: [vaultsCore.address, ethers.constants.AddressZero, stablex.address],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOVaultActions", {
        from: owner.address,
        args: [vaultsCore.address, vaultsDataProvider.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
});
