import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { MIMOAutoRebalance, MIMOProxyGuard } from "../../../typechain";
import { getSelector } from "../../utils";
import { baseSetup } from "../baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("500");
const BORROW_AMOUNT = ethers.utils.parseEther("140");
const DELEVERAGE_AMOUNT = ethers.utils.parseEther("27.5");
const MINT_AMOUNT = ethers.utils.parseEther("25");

const setup = deployments.createFixture(async () => {
  const [owner] = await ethers.getSigners();
  const { deploy } = deployments;

  // Leverage existing MIMORebalance test setup
  const {
    mimoProxy,
    addressProvider,
    lendingPool,
    mimoProxyFactory,
    vaultsCore,
    vaultsDataProvider,
    mimoRebalance,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    data,
    accessController,
    configProvider,
  } = await baseSetup();

  // Deploy and fetch non mock contracts
  await deploy("MIMOAutoRebalance", {
    from: owner.address,
    args: [addressProvider.address, lendingPool.address, mimoProxyFactory.address, mimoRebalance.address],
  });
  const autoRebalance: MIMOAutoRebalance = await ethers.getContract("MIMOAutoRebalance");

  // Mock required function calls
  await Promise.all([
    vaultsDataProvider.mock.vaultDebt.withArgs(1).returns(BORROW_AMOUNT),
    vaultsDataProvider.mock.vaultDebt.withArgs(2).returns(MINT_AMOUNT),
    vaultsDataProvider.mock.vaultCollateralBalance.withArgs(1).returns(DEPOSIT_AMOUNT),
    vaultsDataProvider.mock.vaultCollateralBalance.withArgs(2).returns(ethers.utils.parseUnits("30", 6)),
    vaultsDataProvider.mock.vaultCollateralType.withArgs(1).returns(wmatic.address),
    vaultsDataProvider.mock.vaultCollateralType.withArgs(2).returns(usdc.address),
    vaultsDataProvider.mock.vaultId.withArgs(usdc.address, mimoProxy.address).returns(2),
    accessController.mock.hasRole.returns(true),
    priceFeed.mock.convertFrom.withArgs(wmatic.address, DEPOSIT_AMOUNT).returns(ethers.utils.parseEther("200")),
    priceFeed.mock.convertFrom
      .withArgs(usdc.address, ethers.utils.parseUnits("30", 6))
      .returns(ethers.utils.parseEther("30")),
    priceFeed.mock.convertTo.returns(ethers.utils.parseEther("70")),
    priceFeed.mock.convertFrom
      .withArgs(wmatic.address, ethers.utils.parseEther("70"))
      .returns(ethers.utils.parseEther("70")),
    priceFeed.mock.convertFrom.withArgs(usdc.address, 0).returns(ethers.utils.parseEther("70")),
    configProvider.mock.collateralMinCollateralRatio.withArgs(usdc.address).returns(ethers.utils.parseUnits("110", 16)),
  ]);

  const mimoProxyState = await mimoProxyFactory.getProxyState(mimoProxy.address);
  const mimoProxyGuard: MIMOProxyGuard = await ethers.getContractAt("MIMOProxyGuard", mimoProxyState.proxyGuard);

  // Set permission on deployed MIMOProxy to allow MIMORebalance callback
  await mimoProxyGuard.setPermission(
    autoRebalance.address,
    mimoRebalance.address,
    getSelector(
      mimoRebalance.interface.functions[
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
      ].format(),
    ),
    true,
  );

  const autoVault = {
    isAutomated: true,
    toCollateral: usdc.address,
    allowedVariation: ethers.utils.parseUnits("1", 16),
    targetRatio: ethers.utils.parseUnits("150", 16),
    triggerRatio: ethers.utils.parseUnits("145", 16),
    mcrBuffer: ethers.utils.parseUnits("10", 16),
    fixedFee: 0,
    varFee: 0,
  };

  await autoRebalance.setAutomation(1, autoVault);

  // Format mimoRebalance arguments to avoid code duplication
  const flData = {
    asset: wmatic.address,
    proxyAction: autoRebalance.address,
    amount: DELEVERAGE_AMOUNT,
  };
  const rbData = {
    toCollateral: usdc.address,
    vaultId: 1,
    mintAmount: MINT_AMOUNT,
  };

  const swapData = {
    dexIndex: 1,
    dexTxData: data.tx.data,
  };

  return {
    owner,
    mimoProxy,
    addressProvider,
    lendingPool,
    mimoProxyFactory,
    vaultsCore,
    vaultsDataProvider,
    mimoRebalance,
    priceFeed,
    stablex,
    autoRebalance,
    deploy,
    wmatic,
    usdc,
    data,
    flData,
    rbData,
    swapData,
  };
});

describe("--- MIMOAutoRebalance Unit Test ---", () => {
  it("should set state variable correctly", async () => {
    const { autoRebalance, mimoRebalance } = await setup();
    const _mimoRebalance = await autoRebalance.mimoRebalance();
    expect(_mimoRebalance).to.be.equal(mimoRebalance.address);
  });
  it("should revert if trying to set state variable to address 0", async () => {
    const { addressProvider, lendingPool, mimoProxyFactory, deploy, owner } = await setup();
    await expect(
      deploy("MIMOAutoRebalance", {
        from: owner.address,
        args: [addressProvider.address, lendingPool.address, mimoProxyFactory.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should rever if trying to set variable fee above maximum variable fee", async () => {
    const { usdc, autoRebalance } = await setup();
    const autoVault = {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      targetRatio: ethers.utils.parseUnits("150", 16),
      triggerRatio: ethers.utils.parseUnits("145", 16),
      mcrBuffer: ethers.utils.parseUnits("10", 16),
      fixedFee: 0,
      varFee: ethers.utils.parseEther("1.5"),
    };
    await expect(autoRebalance.setAutomation(1, autoVault)).to.be.revertedWith(
      `VARIABLE_FEE_TOO_HIGH(${ethers.utils.parseEther("1.5")}, ${ethers.utils.parseEther("1.5")})`,
    );
  });
  it("should revert if vault debt is 0", async () => {
    const { autoRebalance, vaultsDataProvider, swapData } = await setup();
    await vaultsDataProvider.mock.vaultDebt.withArgs(1).returns(0);
    await expect(autoRebalance.rebalance(1, swapData)).to.be.revertedWith(
      `VAULT_TRIGGER_RATIO_NOT_REACHED(${ethers.constants.MaxUint256}, ${ethers.utils.parseUnits("145", 16)})`,
    );
  });
  it("should revert if vault is not automated", async () => {
    const { autoRebalance, usdc, swapData } = await setup();
    await autoRebalance.setAutomation(1, {
      isAutomated: false,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      targetRatio: ethers.utils.parseUnits("150", 16),
      triggerRatio: ethers.utils.parseUnits("140", 16),
      mcrBuffer: ethers.utils.parseUnits("10", 16),
      fixedFee: 0,
      varFee: 0,
    });
    await expect(autoRebalance.rebalance(1, swapData)).to.be.revertedWith("VAULT_NOT_AUTOMATED()");
  });
  it("should revert if final vault ratio lower than set minimum vault ratio", async () => {
    const { autoRebalance, usdc, swapData } = await setup();
    await autoRebalance.setAutomation(1, {
      isAutomated: true,
      toCollateral: usdc.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      targetRatio: ethers.utils.parseUnits("900", 16),
      triggerRatio: ethers.utils.parseUnits("145", 16),
      mcrBuffer: ethers.utils.parseUnits("10", 16),
      fixedFee: 0,
      varFee: 0,
    });
    await expect(autoRebalance.rebalance(1, swapData)).to.be.revertedWith(
      `FINAL_VAULT_RATIO_TOO_LOW(${ethers.utils.parseUnits("900", 16)}, 1428571428571428571)`,
    );
  });
  it("should revert if initiator other than MIMOManagedRebalance", async () => {
    const { wmatic, autoRebalance, lendingPool, mimoProxy, rbData, swapData, owner } = await setup();
    const params = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [
        mimoProxy.address,
        0,
        [rbData.toCollateral, rbData.vaultId, rbData.mintAmount],
        [swapData.dexIndex, swapData.dexTxData],
      ],
    );
    await expect(
      lendingPool.executeOperation(
        autoRebalance.address,
        [wmatic.address],
        [DELEVERAGE_AMOUNT],
        [0],
        owner.address,
        params,
      ),
    ).to.be.revertedWith(`INITIATOR_NOT_AUTHORIZED("${owner.address}", "${autoRebalance.address}")`);
  });
  it("should revert if msg.sender is other than lending pool", async () => {
    const { wmatic, autoRebalance, lendingPool, mimoProxy, rbData, swapData, owner } = await setup();
    const params = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [
        mimoProxy.address,
        0,
        [rbData.toCollateral, rbData.vaultId, rbData.mintAmount],
        [swapData.dexIndex, swapData.dexTxData],
      ],
    );
    await expect(
      autoRebalance.executeOperation([wmatic.address], [DELEVERAGE_AMOUNT], [0], autoRebalance.address, params),
    ).to.be.revertedWith(`CALLER_NOT_LENDING_POOL("${owner.address}", "${lendingPool.address}")`);
  });
  it("should revert if insufficient funds to repay flashloan", async () => {
    const { wmatic, autoRebalance, lendingPool, mimoProxy, rbData, swapData } = await setup();
    const params = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [
        mimoProxy.address,
        0,
        [rbData.toCollateral, rbData.vaultId, rbData.mintAmount],
        [swapData.dexIndex, swapData.dexTxData],
      ],
    );
    await expect(
      lendingPool.executeOperation(
        autoRebalance.address,
        [wmatic.address],
        [DEPOSIT_AMOUNT.mul(2)],
        [0],
        autoRebalance.address,
        params,
      ),
    ).to.be.reverted;
  });
});
