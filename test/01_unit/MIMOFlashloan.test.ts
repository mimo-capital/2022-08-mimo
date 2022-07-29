import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers } from "hardhat";
import { MIMOFlashloan, MockLendingPool } from "../../typechain";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy"]);
  const { deploy } = deployments;
  const [owner, wmatic, mimoProxy] = await ethers.getSigners();

  // Deploy and fetch non mock contracts
  await deploy("MockLendingPool", {
    from: owner.address,
    args: [],
  });
  const lendingPool: MockLendingPool = await ethers.getContract("MockLendingPool");

  await deploy("MIMOFlashloan", {
    from: owner.address,
    args: [lendingPool.address],
  });
  const mimoFl: MIMOFlashloan = await ethers.getContract("MIMOFlashloan");

  return {
    owner,
    wmatic,
    mimoProxy,
    lendingPool,
    mimoFl,
  };
});

describe("--- MIMOFlashloan Unit Test ---", () => {
  it("should initialize state variables correctly", async () => {
    const { lendingPool, mimoFl } = await setup();
    const _lendingPool = await mimoFl.lendingPool();
    expect(_lendingPool).to.be.equal(lendingPool.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { owner } = await setup();
    const { deploy } = deployments;
    await expect(
      deploy("MIMOFlashloan", {
        from: owner.address,
        args: [ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should be able to call executeOperation", async () => {
    const { mimoFl, wmatic, mimoProxy, owner } = await setup();
    const params = defaultAbiCoder.encode(["address", "uint256"], [owner.address, 2]);
    await mimoFl.executeOperation([wmatic.address], [1], [0], mimoProxy.address, params);
  });
});
