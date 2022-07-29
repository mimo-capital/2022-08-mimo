import chai, { expect } from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { artifacts, deployments, ethers } from "hardhat";
import { MIMOSwap } from "../../typechain";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy"]);
  const { deploy } = deployments;
  const [owner, wmatic, mimoProxy] = await ethers.getSigners();

  // Get artifacts
  const [addressProviderArtifact, dexAddressProviderArtifact] = await Promise.all([
    artifacts.readArtifact("IAddressProvider"),
    artifacts.readArtifact("IDexAddressProvider"),
  ]);

  // Deploy mock contracts
  const [addressProvider, dexAddressProvider] = await Promise.all([
    deployMockContract(owner, addressProviderArtifact.abi),
    deployMockContract(owner, dexAddressProviderArtifact.abi),
  ]);

  // Deploy non mock contracts
  await deploy("MIMOSwap", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address],
  });
  const mimoSwap: MIMOSwap = await ethers.getContract("MIMOSwap");

  return {
    owner,
    wmatic,
    mimoProxy,
    addressProvider,
    dexAddressProvider,
    mimoSwap,
  };
});

describe("--- MIMOSwap Unit Test ---", () => {
  it("should initialize state variables correctly", async () => {
    const { addressProvider, dexAddressProvider, mimoSwap } = await setup();
    const _addressProvider = await mimoSwap.a();
    const _dexAddressProvider = await mimoSwap.dexAP();
    expect(_addressProvider).to.be.equal(addressProvider.address);
    expect(_dexAddressProvider).to.be.equal(dexAddressProvider.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { addressProvider, dexAddressProvider, owner } = await setup();
    const { deploy } = deployments;
    await expect(
      deploy("MIMOSwap", {
        from: owner.address,
        args: [ethers.constants.AddressZero, dexAddressProvider.address],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
    await expect(
      deploy("MIMOSwap", {
        from: owner.address,
        args: [addressProvider.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
});
