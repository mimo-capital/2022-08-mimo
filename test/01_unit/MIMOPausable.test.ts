import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  const { mimoPausable } = await baseSetup();
  const [owner, alice] = await ethers.getSigners();

  return {
    owner,
    alice,
    mimoPausable,
  };
});

describe("--- MIMOPausable Unit Tests ---", async () => {
  it("should be able to pause", async () => {
    const { mimoPausable } = await setup();
    const pausedBefore = await mimoPausable.paused();
    await mimoPausable.pause();
    const pausedAfter = await mimoPausable.paused();
    expect(pausedBefore).to.be.false;
    expect(pausedAfter).to.be.true;
  });
  it("should be able to unpause", async () => {
    const { mimoPausable } = await setup();
    await mimoPausable.pause();
    const pausedBefore = await mimoPausable.paused();
    await mimoPausable.unpause();
    const pausedAfter = await mimoPausable.paused();
    expect(pausedBefore).to.be.true;
    expect(pausedAfter).to.be.false;
  });
  it("should revert if pause() called by other than owner", async () => {
    const { mimoPausable, alice } = await setup();
    await expect(mimoPausable.connect(alice).pause()).to.be.revertedWith("Ownable: caller is not the owner");
  });
  it("should revert if unpause() called by other than owner", async () => {
    const { mimoPausable, alice } = await setup();
    await mimoPausable.pause();
    await expect(mimoPausable.connect(alice).unpause()).to.be.revertedWith("Ownable: caller is not the owner");
  });
});
