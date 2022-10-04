import { BigNumber } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { ADDRESSES } from "../../config/addresses";
import { POLYGON_ENDPOINT } from "../../hardhat.config";
import {
  DexAddressProvider,
  IAccessController,
  IAddressProvider,
  IConfigProvider,
  IERC20,
  IPool,
  IPriceFeed,
  IRatesManager,
  ISTABLEX,
  IVaultsCore,
  IVaultsCoreState,
  IVaultsDataProvider,
  IWETH,
  MIMOAutoRebalance,
  MIMOEmptyVault,
  MIMOLeverage,
  MIMOManagedRebalance,
  MIMOProxy,
  MIMOProxyActions,
  MIMOProxyFactory,
  MIMOProxyGuard,
  MIMORebalance,
  MIMOVaultActions,
} from "../../typechain";

export const baseSetup = deployments.createFixture(async () => {
  const [owner, alice, bob] = await ethers.getSigners();
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
  await deployments.fixture(["Proxy", "Action", "AutomatedAction", "ManagedAction"]);

  // Fetch contracts
  const addressProvider: IAddressProvider = await ethers.getContractAt(
    "IAddressProvider",
    chainAddresses.ADDRESS_PROVIDER,
  );
  const [
    vaultsCoreAddress,
    vaultsDataProviderAddress,
    priceFeedAddress,
    stablexAddress,
    configProviderAddress,
    ratesManagerAddress,
    accessControllerAddress,
  ] = await Promise.all([
    addressProvider.core(),
    addressProvider.vaultsData(),
    addressProvider.priceFeed(),
    addressProvider.stablex(),
    addressProvider.config(),
    addressProvider.ratesManager(),
    addressProvider.controller(),
  ]);

  const [
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    mimoProxyFactory,
    configProvider,
    mimoVaultActions,
    mimoProxyActions,
    lendingPool,
    ratesManager,
    mimoRebalance,
    mimoLeverage,
    mimoEmptyVault,
    mimoAutoRebalance,
    mimoManagedRebalance,
    accessController,
    dexAddressProvider,
  ] = (await Promise.all([
    ethers.getContractAt("IVaultsCore", vaultsCoreAddress),
    ethers.getContractAt("IVaultsDataProvider", vaultsDataProviderAddress),
    ethers.getContractAt("IPriceFeed", priceFeedAddress),
    ethers.getContractAt("ISTABLEX", stablexAddress),
    ethers.getContractAt("IWETH", chainAddresses.WMATIC),
    ethers.getContractAt("IERC20", chainAddresses.USDC),
    ethers.getContract("MIMOProxyFactory"),
    ethers.getContractAt("IConfigProvider", configProviderAddress),
    ethers.getContract("MIMOVaultActions"),
    ethers.getContract("MIMOProxyActions"),
    ethers.getContractAt("IPool", chainAddresses.AAVE_POOL),
    ethers.getContractAt("IRatesManager", ratesManagerAddress),
    ethers.getContract("MIMORebalance"),
    ethers.getContract("MIMOLeverage"),
    ethers.getContract("MIMOEmptyVault"),
    ethers.getContract("MIMOAutoRebalance"),
    ethers.getContract("MIMOManagedRebalance"),
    ethers.getContractAt("IAccessController", accessControllerAddress),
    ethers.getContractAt("DexAddressProvider", chainAddresses.DEX_ADDRESS_PROVIDER),
  ])) as [
    IVaultsCore,
    IVaultsDataProvider,
    IPriceFeed,
    ISTABLEX,
    IWETH,
    IERC20,
    MIMOProxyFactory,
    IConfigProvider,
    MIMOVaultActions,
    MIMOProxyActions,
    IPool,
    IRatesManager,
    MIMORebalance,
    MIMOLeverage,
    MIMOEmptyVault,
    MIMOAutoRebalance,
    MIMOManagedRebalance,
    IAccessController,
    DexAddressProvider,
  ];

  const vaultsCoreStateAddress = await vaultsCore.state();
  const vaultsCoreState: IVaultsCoreState = await ethers.getContractAt("IVaultsCoreState", vaultsCoreStateAddress);

  const premium = await lendingPool.FLASHLOAN_PREMIUM_TOTAL();

  await mimoProxyFactory.deploy();
  const deployedMIMOProxy = await mimoProxyFactory.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);
  const mimoProxyState = await mimoProxyFactory.getProxyState(mimoProxy.address);
  const mimoProxyGuard: MIMOProxyGuard = await ethers.getContractAt("MIMOProxyGuard", mimoProxyState.proxyGuard);

  // Grant minter role to owner
  owner.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther("20") });

  const MINITER_ROLE = await accessController.MINTER_ROLE();
  await accessController.connect(multisig).grantRole(MINITER_ROLE, owner.address);

  // Helper function calculating the updated vault debt by simulating refreshCollateral()
  const getUpdatedVaultDebt = async (
    vaultId: BigNumber,
    latestTime: BigNumber,
    lastRefresh: BigNumber,
    collateralType: string,
    cumulativeRate: BigNumber,
  ): Promise<BigNumber> => {
    const borrowRate = await configProvider.collateralBorrowRate(collateralType);
    const timeElapsed = latestTime.sub(lastRefresh);
    console.log("timeElapsed", timeElapsed.toString());
    const updatedCumulativeRate = await ratesManager.calculateCumulativeRate(borrowRate, cumulativeRate, timeElapsed);
    const vaultBaseDebt = await vaultsDataProvider.vaultBaseDebt(vaultId);
    return ratesManager.calculateDebt(vaultBaseDebt, updatedCumulativeRate);
  };

  return {
    owner,
    alice,
    bob,
    mimoProxyGuard,
    mimoProxyFactory,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    vaultsCoreState,
    wmatic,
    priceFeed,
    stablex,
    usdc,
    multisig,
    mimoVaultActions,
    configProvider,
    mimoProxyActions,
    premium,
    mimoRebalance,
    mimoLeverage,
    mimoEmptyVault,
    mimoAutoRebalance,
    mimoManagedRebalance,
    accessController,
    dexAddressProvider,
    getUpdatedVaultDebt,
  };
});
