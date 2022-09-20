import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { baseSetup } from "./baseFixture";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("50");
const BORROW_AMOUNT = ethers.utils.parseEther("5");
const WAD = ethers.constants.WeiPerEther;

const setup = deployments.createFixture(async () => {
  const {
    owner,
    vaultsCore,
    vaultsDataProvider,
    accessController,
    stablex,
    wmatic,
    mimoProxy,
    configProvider,
    mimoVaultActions,
    multisig,
  } = await baseSetup();

  // Get WMATIC and approve them for MIMOProxy
  await wmatic.deposit({ value: DEPOSIT_AMOUNT });
  await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);

  // Give minter role to owner
  owner.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther("20") });
  const MINITER_ROLE = await accessController.MINTER_ROLE();
  await accessController.connect(multisig).grantRole(MINITER_ROLE, owner.address);
  await stablex.approve(mimoProxy.address, ethers.constants.MaxUint256);

  return {
    owner,
    vaultsCore,
    vaultsDataProvider,
    configProvider,
    mimoVaultActions,
    mimoProxy,
    wmatic,
    stablex,
  };
});

describe("--- MIMOVaultActions Integration Tests ---", function () {
  this.retries(5);
  it("should be able to deposit", async () => {
    const { mimoProxy, wmatic, mimoVaultActions, vaultsDataProvider } = await setup();
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalance = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(vaultBalance).to.be.equal(DEPOSIT_AMOUNT);
  });
  it("should be able to deposit ETH", async () => {
    const { mimoProxy, wmatic, mimoVaultActions, vaultsDataProvider } = await setup();
    await mimoProxy.execute(mimoVaultActions.address, mimoVaultActions.interface.encodeFunctionData("depositETH"), {
      value: DEPOSIT_AMOUNT,
    });
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalance = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(vaultBalance).to.be.equal(DEPOSIT_AMOUNT);
  });
  it("should be able to deposit and borrow", async () => {
    const { mimoProxy, wmatic, mimoVaultActions, vaultsDataProvider, configProvider, stablex, owner } = await setup();
    const parBalanceBefore = await stablex.balanceOf(owner.address);
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("depositAndBorrow", [
        wmatic.address,
        DEPOSIT_AMOUNT,
        BORROW_AMOUNT,
      ]),
    );
    const parBalanceAfter = await stablex.balanceOf(owner.address);
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalance = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const originationFee = await configProvider.collateralOriginationFee(wmatic.address);
    expect(vaultBalance).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(vaultDebt.sub(BORROW_AMOUNT.add(BORROW_AMOUNT.mul(originationFee).div(WAD))))).to.be.closeTo(0, 1);
    expect(parBalanceBefore).to.be.equal(ethers.constants.Zero);
    expect(parBalanceAfter).to.be.equal(BORROW_AMOUNT);
  });
  it("should be able to deposit ETH and borrow", async () => {
    const { mimoProxy, wmatic, mimoVaultActions, vaultsDataProvider, configProvider, stablex, owner } = await setup();
    const parBalanceBefore = await stablex.balanceOf(owner.address);
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("depositETHAndBorrow", [BORROW_AMOUNT]),
      { value: DEPOSIT_AMOUNT },
    );
    const parBalanceAfter = await stablex.balanceOf(owner.address);
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalance = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const originationFee = await configProvider.collateralOriginationFee(wmatic.address);
    expect(vaultBalance).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(vaultDebt.sub(BORROW_AMOUNT.add(BORROW_AMOUNT.mul(originationFee).div(WAD))))).to.be.closeTo(0, 1);
    expect(parBalanceBefore).to.be.equal(ethers.constants.Zero);
    expect(parBalanceAfter).to.be.equal(BORROW_AMOUNT);
  });
  it("should be able to withdraw", async () => {
    const { mimoProxy, wmatic, mimoVaultActions, vaultsDataProvider, owner } = await setup();
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalanceBeforeWithdraw = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const ownerBalanceBeforeWithdraw = await wmatic.balanceOf(owner.address);
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("withdraw", [vaultId, DEPOSIT_AMOUNT]),
    );
    const ownerBalanceAfterWithdraw = await wmatic.balanceOf(owner.address);
    const vaultBalanceAfterWithdraw = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(vaultBalanceBeforeWithdraw).to.be.equal(DEPOSIT_AMOUNT);
    expect(vaultBalanceAfterWithdraw).to.be.equal(ethers.constants.Zero);
    expect(ownerBalanceAfterWithdraw.sub(ownerBalanceBeforeWithdraw)).to.be.equal(DEPOSIT_AMOUNT);
  });
  it("should be able to withdraw ETH", async () => {
    const { mimoProxy, wmatic, mimoVaultActions, vaultsDataProvider, owner } = await setup();
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalanceBeforeWithdraw = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const ownerBalanceBeforeWithdraw = await ethers.provider.getBalance(owner.address);
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("withdrawETH", [vaultId, DEPOSIT_AMOUNT]),
    );
    const ownerBalanceAfterWithdraw = await ethers.provider.getBalance(owner.address);
    const vaultBalanceAfterWithdraw = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(vaultBalanceBeforeWithdraw).to.be.equal(DEPOSIT_AMOUNT);
    expect(vaultBalanceAfterWithdraw).to.be.equal(ethers.constants.Zero);
    expect(Number(ownerBalanceAfterWithdraw.sub(ownerBalanceBeforeWithdraw))).to.be.closeTo(
      Number(DEPOSIT_AMOUNT),
      1e16,
    );
  });
  it("should be able to borrow", async () => {
    const { mimoProxy, wmatic, mimoVaultActions, vaultsDataProvider, configProvider, stablex, owner } = await setup();
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultDebtBeforeBorrow = await vaultsDataProvider.vaultDebt(vaultId);
    const ownerBalanceBeforeBorrow = await stablex.balanceOf(owner.address);
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("borrow", [vaultId, BORROW_AMOUNT]),
    );
    const ownerBalanceAfterBorrow = await stablex.balanceOf(owner.address);
    const originationFee = await configProvider.collateralOriginationFee(wmatic.address);
    const vaultDebtBeforeAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(vaultDebtBeforeBorrow).to.be.equal(ethers.constants.Zero);
    expect(
      Number(vaultDebtBeforeAfter.sub(BORROW_AMOUNT.add(BORROW_AMOUNT.mul(originationFee).div(WAD)))),
    ).to.be.closeTo(0, 1);
    expect(ownerBalanceBeforeBorrow).to.be.equal(ethers.constants.Zero);
    expect(ownerBalanceAfterBorrow).to.be.equal(BORROW_AMOUNT);
  });
  it("should not be able to reuse msg.value for multiple deposits", async () => {
    const { mimoProxy, mimoVaultActions, vaultsDataProvider, wmatic } = await setup();
    await mimoProxy.execute(mimoVaultActions.address, mimoVaultActions.interface.encodeFunctionData("depositETH"), {
      value: DEPOSIT_AMOUNT,
    });
    const vaultIdBefore = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultIdBefore);
    const data = mimoVaultActions.interface.encodeFunctionData("depositETH");
    mimoProxy.batch(
      [
        mimoProxy.interface.encodeFunctionData("execute", [mimoVaultActions.address, data]),
        mimoProxy.interface.encodeFunctionData("execute", [mimoVaultActions.address, data]),
      ],
      false,
      { value: DEPOSIT_AMOUNT },
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(vaultBalanceAfter).to.be.equal(vaultBalanceBefore.add(DEPOSIT_AMOUNT));
  });
  it("should revert if paused", async () => {
    const { mimoVaultActions, mimoProxy, wmatic } = await setup();
    await mimoVaultActions.pause();
    // Cannot use revertedWith as custom error message bubble up in low level call not supported by hardhat
    await expect(
      mimoProxy.execute(
        mimoVaultActions.address,
        mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
      ),
    ).to.be.reverted;
    await expect(
      mimoProxy.execute(mimoVaultActions.address, mimoVaultActions.interface.encodeFunctionData("depositETH"), {
        value: DEPOSIT_AMOUNT,
      }),
    ).to.be.reverted;
    await expect(
      mimoProxy.execute(
        mimoVaultActions.address,
        mimoVaultActions.interface.encodeFunctionData("depositAndBorrow", [
          wmatic.address,
          DEPOSIT_AMOUNT,
          BORROW_AMOUNT,
        ]),
      ),
    ).to.be.reverted;
    await expect(
      mimoProxy.execute(
        mimoVaultActions.address,
        mimoVaultActions.interface.encodeFunctionData("depositETHAndBorrow", [BORROW_AMOUNT]),
        { value: DEPOSIT_AMOUNT },
      ),
    ).to.be.reverted;
    await expect(
      mimoProxy.execute(
        mimoVaultActions.address,
        mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
      ),
    ).to.be.reverted;
    await expect(
      mimoProxy.execute(
        mimoVaultActions.address,
        mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
      ),
    ).to.be.reverted;
    await expect(
      mimoProxy.execute(
        mimoVaultActions.address,
        mimoVaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
      ),
    ).to.be.reverted;
  });
});
