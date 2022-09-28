import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { baseSetup } from "../baseFixture";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  const {
    addressProvider,
    accessController,
    vaultsDataProvider,
    usdc,
    configProvider,
    mimoProxy,
    mimoProxyFactory,
    mimoAutoAction,
    deploy,
  } = await baseSetup();
  const [owner, alice] = await ethers.getSigners();

  // Mock required function calls
  await Promise.all([
    accessController.mock.hasRole.returns(true),
    vaultsDataProvider.mock.vaultOwner.returns(mimoProxy.address),
    configProvider.mock.collateralMinCollateralRatio.withArgs(usdc.address).returns(ethers.utils.parseEther("1.1")),
  ]);

  return {
    owner,
    alice,
    addressProvider,
    accessController,
    vaultsDataProvider,
    mimoProxyFactory,
    mimoAutoAction,
    deploy,
    mimoProxy,
    usdc,
  };
});

describe("--- MIMOAutoAction Unit Test ---", () => {
  it("should set state variables correctly", async () => {
    const { addressProvider, mimoProxyFactory, mimoAutoAction } = await setup();
    const _addressProvider = await mimoAutoAction.a();
    const _proxyRegistry = await mimoAutoAction.proxyFactory();
    expect(_addressProvider).to.be.equal(addressProvider.address);
    expect(_proxyRegistry).to.be.equal(mimoProxyFactory.address);
  });
  it("should revert if trying to set state variables to address 0", async () => {
    const { addressProvider, mimoProxyFactory, deploy, owner } = await setup();
    await expect(
      deploy("MIMOAutoAction", {
        from: owner.address,
        args: [ethers.constants.AddressZero, mimoProxyFactory.address],
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
    const { mimoAutoAction, usdc } = await setup();
    await expect(
      mimoAutoAction.setAutomation(1, {
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
      .to.emit(mimoAutoAction, "AutomationSet")
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
    const autoVault = await mimoAutoAction.getAutomatedVault(1);
    expect(autoVault.isAutomated).to.be.true;
    expect(autoVault.toCollateral).to.be.equal(usdc.address);
    expect(autoVault.allowedVariation).to.be.equal(ethers.utils.parseUnits("1", 16));
    expect(autoVault.targetRatio).to.be.equal(ethers.utils.parseUnits("150", 16));
    expect(autoVault.triggerRatio).to.be.equal(ethers.utils.parseUnits("140", 16));
    expect(autoVault.fixedFee).to.be.equal(ethers.constants.Zero);
    expect(autoVault.varFee).to.be.equal(ethers.constants.Zero);
  });
  it("should rever if trying to set automation by other then proxy owner", async () => {
    const { mimoAutoAction, alice, mimoProxy, usdc } = await setup();
    await expect(
      mimoAutoAction.connect(alice).setAutomation(1, {
        isAutomated: true,
        toCollateral: usdc.address,
        allowedVariation: ethers.utils.parseUnits("1", 16),
        targetRatio: ethers.utils.parseUnits("150", 16),
        triggerRatio: ethers.utils.parseUnits("140", 16),
        mcrBuffer: ethers.utils.parseUnits("10", 16),
        fixedFee: 0,
        varFee: 0,
      }),
    ).to.be.revertedWith(`CALLER_NOT_VAULT_OWNER("${ethers.constants.AddressZero}", "${mimoProxy.address}")`);
  });
});
