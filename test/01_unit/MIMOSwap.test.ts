import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  const { addressProvider, dexAddressProvider, mimoSwap } = await baseSetup();
  const [owner, wmatic, mimoProxy] = await ethers.getSigners();

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
