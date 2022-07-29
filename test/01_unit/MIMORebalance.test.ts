import chai, { expect } from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { artifacts, deployments, ethers } from "hardhat";
import { MIMOProxy, MIMOProxyRegistry, MIMORebalance, MockLendingPool } from "../../typechain";
import { getOneInchTxData, getSelector, OneInchSwapParams } from "../utils";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");
const DELEVERAGE_AMOUNT = DEPOSIT_AMOUNT.mul(75).div(100);

export const setup = deployments.createFixture(async () => {
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
  ] = await Promise.all([
    artifacts.readArtifact("IAddressProvider"),
    artifacts.readArtifact("IVaultsCore"),
    artifacts.readArtifact("IVaultsDataProvider"),
    artifacts.readArtifact("IPriceFeed"),
    artifacts.readArtifact("ISTABLEX"),
    artifacts.readArtifact("IWETH"),
    artifacts.readArtifact("IDexAddressProvider"),
    artifacts.readArtifact("IERC20"),
  ]);

  // Deploy mock contracts
  const [addressProvider, vaultsCore, vaultsDataProvider, priceFeed, stablex, wmatic, dexAddressProvider, usdc] =
    await Promise.all([
      deployMockContract(owner, addressProviderArtifact.abi),
      deployMockContract(owner, vaultsCoreArtifact.abi),
      deployMockContract(owner, vaultsDataProviderArtifact.abi),
      deployMockContract(owner, priceFeedArtifact.abi),
      deployMockContract(owner, stablexArtifact.abi),
      deployMockContract(owner, wethArtifact.abi),
      deployMockContract(owner, dexAddressProviderArtifact.abi),
      deployMockContract(owner, erc20Artifact.abi),
    ]);

  // Deploy and fetch non mock contracts
  const mimoProxyRegistry: MIMOProxyRegistry = await ethers.getContract("MIMOProxyRegistry");

  await deploy("MockLendingPool", {
    from: owner.address,
    args: [],
  });
  const lendingPool: MockLendingPool = await ethers.getContract("MockLendingPool");

  await deploy("MIMORebalance", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, mimoProxyRegistry.address],
  });
  const rebalance: MIMORebalance = await ethers.getContract("MIMORebalance");

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

  // Set permission on deployed MIMOProxy to allow MIMORebalance callback
  await mimoProxy.setPermission(
    rebalance.address,
    rebalance.address,
    getSelector(
      rebalance.interface.functions[
        "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
      ].format(),
    ),
    true,
  );

  // Mock required function calls
  await Promise.all([
    wmatic.mock.transfer.returns(true),
    wmatic.mock.approve.returns(true),
    wmatic.mock.allowance.returns(DELEVERAGE_AMOUNT),
    wmatic.mock.balanceOf.withArgs(rebalance.address).returns(DELEVERAGE_AMOUNT),
    dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    ),
    usdc.mock.balanceOf.withArgs(mimoProxy.address).returns(5000000),
    usdc.mock.approve.returns(true),
    usdc.mock.allowance.withArgs(mimoProxy.address, vaultsCore.address).returns(5000000),
    vaultsCore.mock.depositAndBorrow.returns(),
    vaultsCore.mock.repay.returns(),
    vaultsCore.mock.withdraw.returns(),
    addressProvider.mock.stablex.returns(stablex.address),
    addressProvider.mock.core.returns(vaultsCore.address),
    addressProvider.mock.vaultsData.returns(vaultsDataProvider.address),
    vaultsDataProvider.mock.vaultCollateralBalance.withArgs(1).returns(DELEVERAGE_AMOUNT),
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
    mimoProxyRegistry,
    lendingPool,
    rebalance,
    priceFeed,
    stablex,
    data,
    usdc,
  };
}, "UnitTestRebalanceFixture");

describe("--- MIMORebalance Unit Tests ---", () => {
  it("should be able to rebalance", async () => {
    const { mimoProxy, rebalance, wmatic, owner, lendingPool, data, usdc } = await setup();
    const rebalanceData = [
      [wmatic.address, rebalance.address, DELEVERAGE_AMOUNT],
      [usdc.address, 1, ethers.utils.parseEther("5")], // Aribitrary because mock
      [1, data.tx.data],
    ];
    const MIMOProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await mimoProxy.execute(rebalance.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [owner.address, [usdc.address, 1, DELEVERAGE_AMOUNT], [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      rebalance.address,
      [wmatic.address],
      [DELEVERAGE_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should revert if initiator is not mimoProxy", async () => {
    const { mimoProxy, rebalance, wmatic, owner, lendingPool, data, usdc } = await setup();
    const rebalanceData = [
      [wmatic.address, rebalance.address, DELEVERAGE_AMOUNT],
      [usdc.address, 1, ethers.utils.parseEther("5")],
      [1, data.tx.data],
    ];
    const MIMOProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await mimoProxy.execute(rebalance.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [owner.address, [usdc.address, 1, DELEVERAGE_AMOUNT], [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(
        rebalance.address,
        [wmatic.address],
        [DELEVERAGE_AMOUNT],
        [0],
        owner.address,
        params,
      ),
    ).to.be.revertedWith(`INITIATOR_NOT_AUTHORIZED("${owner.address}", "${mimoProxy.address}")`);
  });
  it("should revert if executeOperation called by other than lending pool", async () => {
    const { mimoProxy, rebalance, wmatic, owner, data, usdc, lendingPool } = await setup();
    const rebalanceData = [
      [wmatic.address, rebalance.address, DELEVERAGE_AMOUNT],
      [usdc.address, 1, ethers.utils.parseEther("5")],
      [1, data.tx.data],
    ];
    const MIMOProxyData = rebalance.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["tuple(address,address,uint256)", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
        rebalanceData,
      ),
    ]);
    await mimoProxy.execute(rebalance.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "tuple(address,uint256,uint256)", "tuple(uint256,bytes)"],
      [owner.address, [usdc.address, 1, DELEVERAGE_AMOUNT], [1, data.tx.data]],
    );
    await expect(
      rebalance.executeOperation([wmatic.address], [DELEVERAGE_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith(`CALLER_NOT_LENDING_POOL("${owner.address}", "${lendingPool.address}")`);
  });
});
