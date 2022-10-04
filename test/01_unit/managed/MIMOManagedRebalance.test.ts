import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { MIMOManagedRebalance } from "../../../typechain";
import { getSelector } from "../../utils";
import { baseSetup } from "../baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("100");
const BORROW_AMOUNT = ethers.utils.parseEther("10");
const DELEVERAGE_AMOUNT = DEPOSIT_AMOUNT.mul(70).div(100);
const MINT_AMOUNT = BORROW_AMOUNT.mul(75).div(100);

const setup = deployments.createFixture(async () => {
  const [owner, managerA, managerB, managerC] = await ethers.getSigners();
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
    mimoProxyGuard,
  } = await baseSetup();

  // Deploy and fetch non mock contracts
  await deploy("MIMOManagedRebalance", {
    from: owner.address,
    args: [addressProvider.address, lendingPool.address, mimoProxyFactory.address, mimoRebalance.address],
  });
  const mimoManagedRebalance: MIMOManagedRebalance = await ethers.getContract("MIMOManagedRebalance");

  // Mock required function calls
  await Promise.all([
    vaultsDataProvider.mock.vaultOwner.returns(mimoProxy.address),
    vaultsDataProvider.mock.vaultDebt.withArgs(1).returns(MINT_AMOUNT),
    vaultsDataProvider.mock.vaultDebt.withArgs(2).returns(MINT_AMOUNT),
    vaultsDataProvider.mock.vaultCollateralBalance.withArgs(1).returns(DEPOSIT_AMOUNT.sub(DELEVERAGE_AMOUNT)),
    vaultsDataProvider.mock.vaultCollateralBalance.withArgs(2).returns(ethers.utils.parseUnits("75", 6)),
    vaultsDataProvider.mock.vaultCollateralType.withArgs(1).returns(wmatic.address),
    vaultsDataProvider.mock.vaultCollateralType.withArgs(2).returns(usdc.address),
    vaultsDataProvider.mock.vaultId.withArgs(wmatic.address, mimoProxy.address).returns(1),
    vaultsDataProvider.mock.vaultId.withArgs(usdc.address, mimoProxy.address).returns(2),
    accessController.mock.MANAGER_ROLE.returns(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))),
    accessController.mock.hasRole.returns(true),
    priceFeed.mock.convertFrom.withArgs(wmatic.address, DELEVERAGE_AMOUNT).returns(DELEVERAGE_AMOUNT),
    priceFeed.mock.convertFrom.withArgs(usdc.address, ethers.utils.parseUnits("75", 6)).returns(DELEVERAGE_AMOUNT),
    priceFeed.mock.convertFrom.withArgs(usdc.address, 0).returns(DELEVERAGE_AMOUNT),
    priceFeed.mock.convertFrom
      .withArgs(wmatic.address, DEPOSIT_AMOUNT.sub(DELEVERAGE_AMOUNT))
      .returns(DEPOSIT_AMOUNT.sub(DELEVERAGE_AMOUNT)),
    stablex.mock.transfer.returns(true),
    wmatic.mock.balanceOf.withArgs(mimoManagedRebalance.address).returns(DELEVERAGE_AMOUNT),
    wmatic.mock.transfer.returns(true),
    wmatic.mock.approve.returns(true),
    wmatic.mock.allowance.returns(DELEVERAGE_AMOUNT),
    configProvider.mock.collateralMinCollateralRatio.withArgs(usdc.address).returns(ethers.utils.parseUnits("1.1", 18)),
    usdc.mock.balanceOf.withArgs(mimoProxy.address).returns(5000000),
    usdc.mock.approve.returns(true),
    usdc.mock.allowance.withArgs(mimoProxy.address, vaultsCore.address).returns(5000000),
    vaultsCore.mock.depositAndBorrow.returns(),
    vaultsCore.mock.repay.returns(),
    vaultsCore.mock.withdraw.returns(),
  ]);

  // Set permission on deployed MIMOProxy to allow MIMORebalance callback
  await mimoProxyGuard.setPermission(
    mimoManagedRebalance.address,
    mimoRebalance.address,
    getSelector(
      mimoRebalance.interface.functions[
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
      ].format(),
    ),
    true,
  );

  // Set manager and management
  await mimoManagedRebalance.setManager(managerA.address, true);
  await mimoManagedRebalance.setManager(managerB.address, true);

  await mimoManagedRebalance.setManagement(1, {
    isManaged: true,
    manager: managerA.address,
    allowedVariation: ethers.utils.parseUnits("1", 16),
    minRatio: ethers.utils.parseUnits("150", 16),
    fixedFee: 0,
    varFee: 0,
    mcrBuffer: ethers.utils.parseUnits("10", 16),
  });

  // Format mimoRebalance arguments to avoid code duplication
  const flData = {
    asset: wmatic.address,
    proxyAction: mimoManagedRebalance.address,
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
    mimoManagedRebalance,
    managerA,
    managerB,
    deploy,
    wmatic,
    usdc,
    data,
    flData,
    rbData,
    swapData,
    managerC,
  };
});

describe("--- MIMOManagedRebalance Unit Test ---", () => {
  it("should set state variable correctly", async () => {
    const { mimoManagedRebalance, mimoRebalance } = await setup();
    const _mimoRebalance = await mimoManagedRebalance.mimoRebalance();
    expect(_mimoRebalance).to.be.equal(mimoRebalance.address);
  });
  it("should revert if trying to set state variable to address 0", async () => {
    const { addressProvider, lendingPool, mimoProxyFactory, deploy, owner } = await setup();
    await expect(
      deploy("MIMOManagedRebalance", {
        from: owner.address,
        args: [addressProvider.address, lendingPool.address, mimoProxyFactory.address, ethers.constants.AddressZero],
      }),
    ).to.be.revertedWith("CANNOT_SET_TO_ADDRESS_ZERO()");
  });
  it("should be able to mimoRebalance from WMATIC to USDC without manager fee", async () => {
    const {
      wmatic,
      mimoManagedRebalance,
      managerA,
      lendingPool,
      mimoProxy,
      flData,
      rbData,
      swapData,
      vaultsDataProvider,
    } = await setup();
    vaultsDataProvider.mock.vaultCollateralBalance.withArgs(1).returns(DELEVERAGE_AMOUNT);
    await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const params = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [
        mimoProxy.address,
        0,
        [rbData.toCollateral, rbData.vaultId, rbData.mintAmount],
        [swapData.dexIndex, swapData.dexTxData],
      ],
    );
    await lendingPool.executeOperation(
      mimoManagedRebalance.address,
      [wmatic.address],
      [DELEVERAGE_AMOUNT],
      [0],
      mimoManagedRebalance.address,
      params,
    );
  });
  it("should be able to mimoRebalance with slippage within set limit", async () => {
    const { mimoManagedRebalance, flData, rbData, swapData, managerA, priceFeed, usdc } = await setup();
    await priceFeed.mock.convertFrom.withArgs(usdc.address, 0).returns(DELEVERAGE_AMOUNT.mul(995).div(1000)); // 0.5% slippage
    await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
  });
  it("should return vault stats correctly if vault debt is 0", async () => {
    const { mimoManagedRebalance, managerA, vaultsDataProvider, flData, rbData, swapData } = await setup();
    await vaultsDataProvider.mock.vaultDebt.withArgs(1).returns(0);
    rbData.mintAmount = ethers.constants.Zero;
    await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
  });
  it("should revert if vault is not under management", async () => {
    const { mimoManagedRebalance, managerA, flData, rbData, swapData } = await setup();
    await mimoManagedRebalance.setManagement(1, {
      isManaged: false,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: 0,
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "VAULT_NOT_UNDER_MANAGEMENT()",
    );
  });
  it("should revert if mimoRebalance called by non appointed manager", async () => {
    const { mimoManagedRebalance, flData, rbData, swapData, managerB } = await setup();
    await expect(mimoManagedRebalance.connect(managerB).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "CALLER_NOT_SELECTED_MANAGER()",
    );
  });
  it("should revert if mimoRebalance called by unlisted manager", async () => {
    const { mimoManagedRebalance, flData, rbData, swapData, managerC } = await setup();
    await expect(mimoManagedRebalance.connect(managerC).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "MANAGER_NOT_LISTED()",
    );
  });
  it("should revert if mimoRebalance amount is 0", async () => {
    const { mimoManagedRebalance, flData, rbData, swapData, managerA } = await setup();
    const newFlData = { ...flData };
    newFlData.amount = ethers.constants.Zero;
    await expect(mimoManagedRebalance.connect(managerA).rebalance(newFlData, rbData, swapData)).to.be.revertedWith(
      "REBALANCE_AMOUNT_CANNOT_BE_ZERO()",
    );
  });
  it("should revert if operation tracker has reached max daily call limit", async () => {
    const { mimoManagedRebalance, flData, rbData, swapData, managerA } = await setup();
    const operationTrackerBefore = await mimoManagedRebalance.getOperationTracker(rbData.vaultId);
    const tx = await mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData);
    const receipt = await tx.wait(1);
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const operationTrackerAfter = await mimoManagedRebalance.getOperationTracker(rbData.vaultId);
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "MAX_OPERATIONS_REACHED()",
    );
    expect(operationTrackerBefore).to.be.equal(ethers.constants.Zero);
    expect(operationTrackerAfter).to.be.equal(ethers.BigNumber.from(block.timestamp));
  });
  it("should revert if vault valut change is too high", async () => {
    const { mimoManagedRebalance, flData, rbData, swapData, managerA, priceFeed, usdc } = await setup();
    await priceFeed.mock.convertFrom.withArgs(usdc.address, 0).returns(DELEVERAGE_AMOUNT.div(2));
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "VAULT_VALUE_CHANGE_TOO_HIGH()",
    );
  });
  it("should revert if final vault ratio lower than set minimum vault ratio", async () => {
    const { mimoManagedRebalance, managerA, flData, rbData, swapData } = await setup();
    await mimoManagedRebalance.setManagement(1, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("900", 16),
      fixedFee: 0,
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("10", 16),
    });
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      `FINAL_VAULT_RATIO_TOO_LOW(${ethers.utils.parseUnits("900", 16)}, ${ethers.utils.parseUnits("400", 16)})`,
    );
  });
  it("should revert if vault B final ratio below mcr buffer", async () => {
    const { mimoManagedRebalance, managerA, flData, rbData, swapData } = await setup();
    await mimoManagedRebalance.setManagement(1, {
      isManaged: true,
      manager: managerA.address,
      allowedVariation: ethers.utils.parseUnits("1", 16),
      minRatio: ethers.utils.parseUnits("150", 16),
      fixedFee: 0,
      varFee: 0,
      mcrBuffer: ethers.utils.parseUnits("1000", 16),
    });
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      `FINAL_VAULT_RATIO_TOO_LOW(${ethers.utils.parseUnits("1110", 16)}, 9333333333333333333)`,
    );
  });
  it("should revert if mintAmount > vaultDebt", async () => {
    const { mimoManagedRebalance, flData, rbData, swapData, managerA } = await setup();
    rbData.mintAmount = MINT_AMOUNT.mul(2);
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "MINT_AMOUNT_GREATER_THAN_VAULT_DEBT()",
    );
  });
  it("should revert if initiator other than MIMOManagedRebalance", async () => {
    const { wmatic, mimoManagedRebalance, lendingPool, mimoProxy, rbData, swapData, owner } = await setup();
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
        mimoManagedRebalance.address,
        [wmatic.address],
        [DELEVERAGE_AMOUNT],
        [0],
        owner.address,
        params,
      ),
    ).to.be.revertedWith(`INITIATOR_NOT_AUTHORIZED("${owner.address}", "${mimoManagedRebalance.address}")`);
  });
  it("should revert if msg.sender is other than lending pool", async () => {
    const { wmatic, mimoManagedRebalance, lendingPool, mimoProxy, rbData, swapData, owner } = await setup();
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
      mimoManagedRebalance.executeOperation(
        [wmatic.address],
        [DELEVERAGE_AMOUNT],
        [0],
        mimoManagedRebalance.address,
        params,
      ),
    ).to.be.revertedWith(`CALLER_NOT_LENDING_POOL("${owner.address}", "${lendingPool.address}")`);
  });
  it("should revert if insufficient funds to repay flashloan", async () => {
    const { wmatic, mimoManagedRebalance, lendingPool, mimoProxy, rbData, swapData } = await setup();
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
        mimoManagedRebalance.address,
        [wmatic.address],
        [DELEVERAGE_AMOUNT.mul(2)],
        [0],
        mimoManagedRebalance.address,
        params,
      ),
    ).to.be.reverted;
  });
  it("should revert when paused", async () => {
    const { mimoManagedRebalance, managerA, flData, rbData, swapData, lendingPool, wmatic } = await setup();
    await mimoManagedRebalance.pause();
    await expect(mimoManagedRebalance.connect(managerA).rebalance(flData, rbData, swapData)).to.be.revertedWith(
      "PAUSED()",
    );
    await expect(
      lendingPool.executeOperation(
        mimoManagedRebalance.address,
        [wmatic.address],
        [DELEVERAGE_AMOUNT.mul(2)],
        [0],
        mimoManagedRebalance.address,
        [],
      ),
    ).to.be.revertedWith("PAUSED()");
  });
});
