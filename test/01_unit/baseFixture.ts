import chai from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { keccak256 } from "ethers/lib/utils";
import { artifacts, deployments, ethers } from "hardhat";
import {
  CollisionAttacker,
  MIMOAutoAction,
  MIMOEmptyVault,
  MIMOLeverage,
  MIMOPausable,
  MIMOProxy,
  MIMOProxyActions,
  MIMOProxyFactory,
  MIMOProxyGuard,
  MIMORebalance,
  MIMOSwap,
  MIMOVaultActions,
  MockLendingPool,
} from "../../typechain";
import { getOneInchTxData, getSelector, OneInchSwapParams } from "../utils";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");
const DELEVERAGE_AMOUNT = DEPOSIT_AMOUNT.mul(75).div(100);

export const baseSetup = deployments.createFixture(async () => {
  await deployments.fixture(["Proxy"]);
  const { deploy } = deployments;
  const [owner] = await ethers.getSigners();

  // Get artifacts
  const [
    addressProviderArtifact,
    vaultsCoreArtifact,
    vaultsDataProviderArtifact,
    priceFeedArtifact,
    stablexArtifact,
    wethArtifact,
    dexAddressProviderArtifact,
    erc20Artifact,
    accessControllerArtifact,
    configProviderArtifact,
  ] = await Promise.all([
    artifacts.readArtifact("IAddressProvider"),
    artifacts.readArtifact("IVaultsCore"),
    artifacts.readArtifact("IVaultsDataProvider"),
    artifacts.readArtifact("IPriceFeed"),
    artifacts.readArtifact("ISTABLEX"),
    artifacts.readArtifact("IWETH"),
    artifacts.readArtifact("IDexAddressProvider"),
    artifacts.readArtifact("IERC20"),
    artifacts.readArtifact("IAccessController"),
    artifacts.readArtifact("IConfigProvider"),
  ]);

  // Deploy mock contracts
  const [
    addressProvider,
    vaultsCore,
    vaultsDataProvider,
    priceFeed,
    stablex,
    wmatic,
    dexAddressProvider,
    usdc,
    accessController,
    configProvider,
  ] = await Promise.all([
    deployMockContract(owner, addressProviderArtifact.abi),
    deployMockContract(owner, vaultsCoreArtifact.abi),
    deployMockContract(owner, vaultsDataProviderArtifact.abi),
    deployMockContract(owner, priceFeedArtifact.abi),
    deployMockContract(owner, stablexArtifact.abi),
    deployMockContract(owner, wethArtifact.abi),
    deployMockContract(owner, dexAddressProviderArtifact.abi),
    deployMockContract(owner, erc20Artifact.abi),
    deployMockContract(owner, accessControllerArtifact.abi),
    deployMockContract(owner, configProviderArtifact.abi),
  ]);

  // Deploy and fetch non mock contracts
  const mimoProxyFactory: MIMOProxyFactory = await ethers.getContract("MIMOProxyFactory");

  await deploy("MockLendingPool", {
    from: owner.address,
    args: [],
  });
  const lendingPool: MockLendingPool = await ethers.getContract("MockLendingPool");

  await deploy("MIMORebalance", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, mimoProxyFactory.address],
  });
  await deploy("MIMOEmptyVault", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, mimoProxyFactory.address],
  });
  await deploy("MIMOLeverage", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, mimoProxyFactory.address],
  });
  await deploy("MIMOSwap", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address],
  });
  await deploy("MIMOVaultActions", {
    from: owner.address,
    args: [vaultsCore.address, vaultsDataProvider.address, stablex.address, mimoProxyFactory.address],
  });
  await deploy("MIMOPausable", {
    from: owner.address,
  });
  await deploy("CollisionAttacker", {
    from: owner.address,
    args: [],
  });
  await deploy("MIMOAutoAction", {
    from: owner.address,
    args: [addressProvider.address, mimoProxyFactory.address],
  });
  await deploy("MIMOProxyActions", {
    from: owner.address,
    args: [],
  });

  const [
    mimoRebalance,
    mimoEmptyVault,
    mimoLeverage,
    mimoSwap,
    mimoVaultActions,
    mimoPausable,
    collisionAttacker,
    mimoAutoAction,
    mimoProxyActions,
  ] = (await Promise.all([
    ethers.getContract("MIMORebalance"),
    ethers.getContract("MIMOEmptyVault"),
    ethers.getContract("MIMOLeverage"),
    ethers.getContract("MIMOSwap"),
    ethers.getContract("MIMOVaultActions"),
    ethers.getContract("MIMOPausable"),
    ethers.getContract("CollisionAttacker"),
    ethers.getContract("MIMOAutoAction"),
    ethers.getContract("MIMOProxyActions"),
  ])) as [
    MIMORebalance,
    MIMOEmptyVault,
    MIMOLeverage,
    MIMOSwap,
    MIMOVaultActions,
    MIMOPausable,
    CollisionAttacker,
    MIMOAutoAction,
    MIMOProxyActions,
  ];

  await mimoProxyFactory.deploy();
  const deployedMIMOProxy = await mimoProxyFactory.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);
  const mimoProxyState = await mimoProxyFactory.getProxyState(mimoProxy.address);
  const mimoProxyGuard: MIMOProxyGuard = await ethers.getContractAt("MIMOProxyGuard", mimoProxyState.proxyGuard);

  // Set permission on deployed MIMOProxy to allow MIMORebalance callback
  await mimoProxyGuard.setPermission(
    mimoRebalance.address,
    mimoRebalance.address,
    getSelector(
      mimoRebalance.interface.functions[
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
      ].format(),
    ),
    true,
  );

  // Mock required function calls
  await Promise.all([
    dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    ),
    addressProvider.mock.vaultsData.returns(vaultsDataProvider.address),
    addressProvider.mock.controller.returns(accessController.address),
    addressProvider.mock.priceFeed.returns(priceFeed.address),
    addressProvider.mock.config.returns(configProvider.address),
    addressProvider.mock.stablex.returns(stablex.address),
    addressProvider.mock.core.returns(vaultsCore.address),
    accessController.mock.MANAGER_ROLE.returns(keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))),
    vaultsDataProvider.mock.vaultOwner.returns(mimoProxy.address),
  ]);

  // Fetch aggregator params
  const swapParams: OneInchSwapParams = {
    fromTokenAddress: "0xE2Aa7db6dA1dAE97C5f5C6914d285fBfCC32A128",
    toTokenAddress: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    amount: DELEVERAGE_AMOUNT.toString(),
    fromAddress: mimoProxy.address,
    slippage: 1,
    disableEstimate: true,
  };
  const { data } = await getOneInchTxData(swapParams);

  return {
    owner,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    wmatic,
    addressProvider,
    dexAddressProvider,
    mimoProxyFactory,
    lendingPool,
    mimoRebalance,
    priceFeed,
    stablex,
    data,
    usdc,
    mimoEmptyVault,
    mimoLeverage,
    mimoSwap,
    mimoVaultActions,
    mimoPausable,
    collisionAttacker,
    mimoAutoAction,
    mimoProxyGuard,
    accessController,
    configProvider,
    mimoProxyActions,
    deploy,
  };
});
