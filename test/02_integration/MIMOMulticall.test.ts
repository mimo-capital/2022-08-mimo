import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { deployments, ethers, network } from "hardhat";
import { ADDRESSES } from "../../config/addresses";
import { POLYGON_ENDPOINT } from "../../hardhat.config";
import {
  IAccessController,
  IAddressProvider,
  IConfigProvider,
  ISTABLEX,
  IVaultsCore,
  IVaultsDataProvider,
  IWETH,
  MIMOProxy,
  MIMOProxyRegistry,
} from "../../typechain";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("50");
const BORROW_AMOUNT = ethers.utils.parseEther("5");
const WAD = ethers.constants.WeiPerEther;

const setup = deployments.createFixture(async () => {
  const [owner] = await ethers.getSigners();
  const chainAddresses = ADDRESSES["137"];
  process.env.FORK_ID = "137";

  // Fork polygon mainnet
  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: POLYGON_ENDPOINT,
        },
      },
    ],
  });

  // Impersonate multisig
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [chainAddresses.MULTISIG],
  });
  const multisig = await ethers.getSigner(chainAddresses.MULTISIG);

  // Deploy Proxy contracts
  await deployments.fixture(["Proxy", "MIMOVaultActions"]);

  // Fetch contracts
  const addressProvider: IAddressProvider = await ethers.getContractAt(
    "IAddressProvider",
    chainAddresses.ADDRESS_PROVIDER,
  );
  const [vaultsCoreAddress, vaultsDataProviderAddress, accessControllerAddress, stablexAddress, configProviderAddress] =
    await Promise.all([
      addressProvider.core(),
      addressProvider.vaultsData(),
      addressProvider.controller(),
      addressProvider.stablex(),
      addressProvider.config(),
    ]);

  const [vaultsCore, vaultsDataProvider, accessController, stablex, wmatic, mimoProxyRegistry, configProvider] =
    (await Promise.all([
      ethers.getContractAt("IVaultsCore", vaultsCoreAddress),
      ethers.getContractAt("IVaultsDataProvider", vaultsDataProviderAddress),
      ethers.getContractAt("IAccessController", accessControllerAddress),
      ethers.getContractAt("ISTABLEX", stablexAddress),
      ethers.getContractAt("IWETH", chainAddresses.WMATIC),
      ethers.getContract("MIMOProxyRegistry"),
      ethers.getContractAt("IConfigProvider", configProviderAddress),
    ])) as [IVaultsCore, IVaultsDataProvider, IAccessController, ISTABLEX, IWETH, MIMOProxyRegistry, IConfigProvider];

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

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
    addressProvider,
    vaultsCore,
    vaultsDataProvider,
    configProvider,
    mimoProxy,
    wmatic,
    stablex,
  };
});

describe("--- MIMOMulticall Integration Tests ---", () => {
  it("should be able to deposit", async () => {
    const { mimoProxy, wmatic, vaultsCore, vaultsDataProvider, owner } = await setup();
    await mimoProxy.multicall(
      [wmatic.address, wmatic.address, vaultsCore.address],
      [
        wmatic.interface.encodeFunctionData("transferFrom", [owner.address, mimoProxy.address, DEPOSIT_AMOUNT]),
        wmatic.interface.encodeFunctionData("approve", [vaultsCore.address, DEPOSIT_AMOUNT]),
        vaultsCore.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
      ],
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalance = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(vaultBalance).to.be.equal(DEPOSIT_AMOUNT);
  });
  it("should be able to deposit and borrow", async () => {
    const { mimoProxy, wmatic, vaultsCore, vaultsDataProvider, configProvider, owner } = await setup();
    await mimoProxy.multicall(
      [wmatic.address, wmatic.address, vaultsCore.address],
      [
        wmatic.interface.encodeFunctionData("transferFrom", [owner.address, mimoProxy.address, DEPOSIT_AMOUNT]),
        wmatic.interface.encodeFunctionData("approve", [vaultsCore.address, DEPOSIT_AMOUNT]),
        vaultsCore.interface.encodeFunctionData("depositAndBorrow", [wmatic.address, DEPOSIT_AMOUNT, BORROW_AMOUNT]),
      ],
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalance = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const originationFee = await configProvider.collateralOriginationFee(wmatic.address);
    expect(vaultBalance).to.be.equal(DEPOSIT_AMOUNT);
    expect(Number(vaultDebt.sub(BORROW_AMOUNT.add(BORROW_AMOUNT.mul(originationFee).div(WAD))))).to.be.closeTo(0, 1);
  });
  it("should be able to withraw", async () => {
    const { mimoProxy, wmatic, vaultsCore, vaultsDataProvider, owner } = await setup();
    await mimoProxy.multicall(
      [wmatic.address, wmatic.address, vaultsCore.address],
      [
        wmatic.interface.encodeFunctionData("transferFrom", [owner.address, mimoProxy.address, DEPOSIT_AMOUNT]),
        wmatic.interface.encodeFunctionData("approve", [vaultsCore.address, DEPOSIT_AMOUNT]),
        vaultsCore.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
      ],
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultBalanceBeforeWithdraw = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const mimoProxyBalanceBeforeWithdraw = await wmatic.balanceOf(mimoProxy.address);
    await mimoProxy.multicall(
      [vaultsCore.address],
      [vaultsCore.interface.encodeFunctionData("withdraw", [vaultId, DEPOSIT_AMOUNT])],
    );
    const vaultBalanceAfterWithdraw = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const mimoProxyBalanceAfterWithdraw = await wmatic.balanceOf(mimoProxy.address);
    expect(vaultBalanceBeforeWithdraw).to.be.equal(DEPOSIT_AMOUNT);
    expect(vaultBalanceAfterWithdraw).to.be.equal(ethers.constants.Zero);
    expect(mimoProxyBalanceBeforeWithdraw).to.be.equal(ethers.constants.Zero);
    expect(mimoProxyBalanceAfterWithdraw).to.be.equal(DEPOSIT_AMOUNT);
  });
  it("should be able to borrow", async () => {
    const { mimoProxy, wmatic, vaultsCore, vaultsDataProvider, configProvider, owner } = await setup();
    await mimoProxy.multicall(
      [wmatic.address, wmatic.address, vaultsCore.address],
      [
        wmatic.interface.encodeFunctionData("transferFrom", [owner.address, mimoProxy.address, DEPOSIT_AMOUNT]),
        wmatic.interface.encodeFunctionData("approve", [vaultsCore.address, DEPOSIT_AMOUNT]),
        vaultsCore.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
      ],
    );
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const vaultDebtBeforeBorrow = await vaultsDataProvider.vaultDebt(vaultId);
    await mimoProxy.multicall(
      [vaultsCore.address],
      [vaultsCore.interface.encodeFunctionData("borrow", [vaultId, BORROW_AMOUNT])],
    );
    const originationFee = await configProvider.collateralOriginationFee(wmatic.address);
    const vaultDebtBeforeAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(vaultDebtBeforeBorrow).to.be.equal(ethers.constants.Zero);
    expect(vaultDebtBeforeAfter).to.be.equal(BORROW_AMOUNT.add(BORROW_AMOUNT.mul(originationFee).div(WAD)));
  });
});
