import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers } from "hardhat";
import { MIMOProxyGuard } from "../../../typechain";
import { getSelector, WAD, ZERO } from "../../utils";
import { baseSetup } from "../baseFixture";

chai.use(solidity);

const setup = deployments.createFixture(async () => {
  const {
    owner,
    alice,
    bob,
    vaultsCore,
    vaultsDataProvider,
    accessController,
    stablex,
    wmatic,
    mimoProxy,
    configProvider,
    mimoVaultActions,
    multisig,
    mimoProxyGuard,
    mimoProxyFactory,
  } = await baseSetup();

  return {
    owner,
    alice,
    bob,
    vaultsCore,
    vaultsDataProvider,
    accessController,
    stablex,
    wmatic,
    mimoProxy,
    configProvider,
    mimoVaultActions,
    multisig,
    mimoProxyGuard,
    mimoProxyFactory,
  };
});

describe("MIMOProxyGuard Integration test", async () => {
  it("Should clear all permissions after transferring a mimoProxy if clearPermissions is set to true", async () => {
    const { mimoProxy, alice, bob, mimoProxyGuard, mimoProxyFactory, mimoVaultActions, vaultsDataProvider, wmatic } =
      await setup();

    const depositEthAmount = WAD.mul(5);
    const depositSelector = getSelector(mimoVaultActions.interface.functions["depositETH()"].format());

    // First set permission for owner so that alice can deposit on owner's behalf
    await mimoProxyGuard.setPermission(alice.address, mimoVaultActions.address, depositSelector, true);

    const beforeAliceExecutePermission = await mimoProxyGuard.getPermission(
      alice.address,
      mimoVaultActions.address,
      depositSelector,
    );

    expect(beforeAliceExecutePermission).to.equal(true);

    // Execute deposit to verify that alice can deposit
    let vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const beforeDepositCollateralBal =
      vaultId === ZERO ? ZERO : await vaultsDataProvider.vaultCollateralBalance(vaultId);

    await mimoProxy
      .connect(alice)
      .execute(mimoVaultActions.address, mimoVaultActions.interface.encodeFunctionData("depositETH"), {
        value: depositEthAmount,
      });

    // Re-query vaultId if it was 0 previously
    if ((vaultId = ZERO)) {
      vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    }

    const afterDepositCollateralBal = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(afterDepositCollateralBal).to.equal(beforeDepositCollateralBal.add(depositEthAmount));

    // Transfer mimoProxy over to bob
    await mimoProxyFactory.transferOwnership(mimoProxy.address, bob.address);
    await mimoProxyFactory.connect(bob).claimOwnership(mimoProxy.address, true);

    // Permission should be cleared after transferring the MimoProxy to bob
    const newMimoProxyState = await mimoProxyFactory.getProxyState(mimoProxy.address);
    expect(newMimoProxyState.proxyGuard).to.not.equal(mimoProxyGuard.address);

    const newMimoProxyGuard: MIMOProxyGuard = await ethers.getContractAt(
      "MIMOProxyGuard",
      newMimoProxyState.proxyGuard,
    );

    const afterAliceExecutePermission = await newMimoProxyGuard.getPermission(
      alice.address,
      mimoVaultActions.address,
      depositSelector,
    );
    expect(afterAliceExecutePermission).to.equal(false);

    await expect(
      mimoProxy
        .connect(alice)
        .execute(mimoVaultActions.address, mimoVaultActions.interface.encodeFunctionData("depositETH"), {
          value: depositEthAmount,
        }),
    ).to.be.revertedWith(
      `EXECUTION_NOT_AUTHORIZED("${bob.address}", "${alice.address}", "${mimoVaultActions.address}", "${depositSelector}")`,
    );
  });

  it("Should not clear permissions after transferring a mimoProxy if clearPermissions is set to false", async () => {
    const { mimoProxy, alice, bob, mimoProxyGuard, mimoProxyFactory, mimoVaultActions, vaultsDataProvider, wmatic } =
      await setup();

    const depositEthAmount = WAD.mul(5);
    const depositSelector = getSelector(mimoVaultActions.interface.functions["depositETH()"].format());

    // First set permission for owner so that alice can deposit on owner's behalf
    await mimoProxyGuard.setPermission(alice.address, mimoVaultActions.address, depositSelector, true);

    const beforeAliceExecutePermission = await mimoProxyGuard.getPermission(
      alice.address,
      mimoVaultActions.address,
      depositSelector,
    );

    expect(beforeAliceExecutePermission).to.equal(true);

    // Execute deposit to verify that alice can deposit
    let vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);

    const beforeDepositCollateralBal =
      vaultId === ZERO ? ZERO : await vaultsDataProvider.vaultCollateralBalance(vaultId);

    await mimoProxy
      .connect(alice)
      .execute(mimoVaultActions.address, mimoVaultActions.interface.encodeFunctionData("depositETH"), {
        value: depositEthAmount,
      });

    // Re-query vaultId if it was 0 previously
    if ((vaultId = ZERO)) {
      vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    }

    const afterDepositCollateralBal = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(afterDepositCollateralBal).to.equal(beforeDepositCollateralBal.add(depositEthAmount));

    // Transfer mimoProxy over to bob
    await mimoProxyFactory.transferOwnership(mimoProxy.address, bob.address);
    await mimoProxyFactory.connect(bob).claimOwnership(mimoProxy.address, false);

    // Permission should remain after transferring the MimoProxy to bob
    const newMimoProxyState = await mimoProxyFactory.getProxyState(mimoProxy.address);
    expect(newMimoProxyState.proxyGuard).to.equal(mimoProxyGuard.address);

    const newMimoProxyGuard: MIMOProxyGuard = await ethers.getContractAt(
      "MIMOProxyGuard",
      newMimoProxyState.proxyGuard,
    );

    const afterAliceExecutePermission = await newMimoProxyGuard.getPermission(
      alice.address,
      mimoVaultActions.address,
      depositSelector,
    );
    expect(afterAliceExecutePermission).to.equal(true);

    await mimoProxy
      .connect(alice)
      .execute(mimoVaultActions.address, mimoVaultActions.interface.encodeFunctionData("depositETH"), {
        value: depositEthAmount,
      });

    // Vault Collateral should have increased again after alice's second deposit
    const afterSecondDepositCollateralBal = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(afterSecondDepositCollateralBal).to.equal(beforeDepositCollateralBal.add(depositEthAmount.mul(2)));
  });
});
