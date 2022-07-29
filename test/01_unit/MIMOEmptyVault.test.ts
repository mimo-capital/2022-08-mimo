import chai, { expect } from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { artifacts, deployments, ethers } from "hardhat";
import { MIMOEmptyVault, MIMOProxy, MIMOProxyRegistry, MockLendingPool } from "../../typechain";
import { getOneInchTxData, getSelector, OneInchSwapParams } from "../utils";

chai.use(solidity);

const FL_AMOUNT = ethers.utils.parseEther("10"); // Arbitrary because mock

const setup = deployments.createFixture(async () => {
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
  ] = await Promise.all([
    artifacts.readArtifact("IAddressProvider"),
    artifacts.readArtifact("IVaultsCore"),
    artifacts.readArtifact("IVaultsDataProvider"),
    artifacts.readArtifact("IPriceFeed"),
    artifacts.readArtifact("ISTABLEX"),
    artifacts.readArtifact("IWETH"),
    artifacts.readArtifact("IDexAddressProvider"),
  ]);

  // Deploy mock contracts
  const [addressProvider, vaultsCore, vaultsDataProvider, priceFeed, stablex, wmatic, dexAddressProvider] =
    await Promise.all([
      deployMockContract(owner, addressProviderArtifact.abi),
      deployMockContract(owner, vaultsCoreArtifact.abi),
      deployMockContract(owner, vaultsDataProviderArtifact.abi),
      deployMockContract(owner, priceFeedArtifact.abi),
      deployMockContract(owner, stablexArtifact.abi),
      deployMockContract(owner, wethArtifact.abi),
      deployMockContract(owner, dexAddressProviderArtifact.abi),
    ]);

  // Deploy and fetch non mock contracts
  const mimoProxyRegistry: MIMOProxyRegistry = await ethers.getContract("MIMOProxyRegistry");

  await deploy("MockLendingPool", {
    from: owner.address,
    args: [],
  });
  const lendingPool: MockLendingPool = await ethers.getContract("MockLendingPool");

  await deploy("MIMOEmptyVault", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, mimoProxyRegistry.address],
  });
  const emptyVault: MIMOEmptyVault = await ethers.getContract("MIMOEmptyVault");

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

  // Set permission on deployed MIMOProxy to allow MIMOEmptyVault callback
  await mimoProxy.setPermission(
    emptyVault.address,
    emptyVault.address,
    getSelector(
      emptyVault.interface.functions["emptyVaultOperation(address,uint256,uint256,(uint256,bytes))"].format(),
    ),
    true,
  );

  // Mock required function calls
  await Promise.all([
    wmatic.mock.transfer.returns(true),
    wmatic.mock.approve.returns(true),
    wmatic.mock.allowance.returns(FL_AMOUNT),
    wmatic.mock.balanceOf.withArgs(emptyVault.address).returns(FL_AMOUNT),
    dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    ),
    vaultsCore.mock.repayAll.returns(),
    vaultsCore.mock.withdraw.returns(),
    addressProvider.mock.stablex.returns(stablex.address),
    addressProvider.mock.core.returns(vaultsCore.address),
    vaultsDataProvider.mock.vaultCollateralBalance.returns(FL_AMOUNT),
    addressProvider.mock.vaultsData.returns(vaultsDataProvider.address),
    stablex.mock.approve.returns(true),
    stablex.mock.allowance.returns(FL_AMOUNT),
    stablex.mock.balanceOf.withArgs(mimoProxy.address).returns(FL_AMOUNT),
  ]);

  // Fetch aggregator params
  const swapParams: OneInchSwapParams = {
    fromTokenAddress: "0xE2Aa7db6dA1dAE97C5f5C6914d285fBfCC32A128",
    toTokenAddress: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    amount: FL_AMOUNT.toString(),
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
    mimoProxyRegistry,
    lendingPool,
    emptyVault,
    priceFeed,
    stablex,
    data,
  };
});

describe("--- MIMOEmptyVault Unit Tests ---", () => {
  it("should be able to emptyVault", async () => {
    const { mimoProxy, emptyVault, wmatic, owner, lendingPool, data } = await setup();
    const emptyVaultData = [1, [wmatic.address, emptyVault.address, FL_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = emptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await mimoProxy.execute(emptyVault.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256,bytes)"],
      [owner.address, 1, [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      emptyVault.address,
      [wmatic.address],
      [FL_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should revert if initiator is other than mimo proxy", async () => {
    const { mimoProxy, emptyVault, wmatic, owner, lendingPool, data } = await setup();
    const emptyVaultData = [1, [wmatic.address, emptyVault.address, FL_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = emptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await mimoProxy.execute(emptyVault.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256,bytes)"],
      [owner.address, 1, [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(emptyVault.address, [wmatic.address], [FL_AMOUNT], [0], owner.address, params),
    ).to.be.revertedWith(`INITIATOR_NOT_AUTHORIZED("${owner.address}", "${mimoProxy.address}")`);
  });
  it("should revert if executeOperation is called by other than lending pool", async () => {
    const { mimoProxy, emptyVault, wmatic, owner, data, lendingPool } = await setup();
    const emptyVaultData = [1, [wmatic.address, emptyVault.address, FL_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = emptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await mimoProxy.execute(emptyVault.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256,bytes)"],
      [owner.address, 1, [1, data.tx.data]],
    );
    await expect(
      emptyVault.executeOperation([wmatic.address], [FL_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith(`CALLER_NOT_LENDING_POOL("${owner.address}", "${lendingPool.address}")`);
  });
});
