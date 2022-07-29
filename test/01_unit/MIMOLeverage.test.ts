import chai, { expect } from "chai";
import { deployMockContract, solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { artifacts, deployments, ethers } from "hardhat";
import { MIMOLeverage, MIMOProxy, MIMOProxyRegistry, MockLendingPool } from "../../typechain";
import { getOneInchTxData, getSelector, OneInchSwapParams } from "../utils";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");
const BORROW_AMOUNT = ethers.utils.parseEther("10");
const PAR_TO_SELL = ethers.utils.parseEther("5");

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

  // Deploy and fetch non mock contrac
  const mimoProxyRegistry: MIMOProxyRegistry = await ethers.getContract("MIMOProxyRegistry");

  await deploy("MockLendingPool", {
    from: owner.address,
    args: [],
  });
  const lendingPool: MockLendingPool = await ethers.getContract("MockLendingPool");

  await deploy("MIMOLeverage", {
    from: owner.address,
    args: [addressProvider.address, dexAddressProvider.address, lendingPool.address, mimoProxyRegistry.address],
  });
  const leverage: MIMOLeverage = await ethers.getContract("MIMOLeverage");

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

  // Set permission on deployed MIMOProxy to allow MIMOLeverage callback
  await mimoProxy.setPermission(
    leverage.address,
    leverage.address,
    getSelector(leverage.interface.functions["leverageOperation(address,uint256,uint256,(uint256,bytes))"].format()),
    true,
  );

  // Mock required function calls
  await Promise.all([
    wmatic.mock.allowance.returns(BORROW_AMOUNT),
    wmatic.mock.approve.returns(true),
    wmatic.mock.transfer.returns(true),
    wmatic.mock.transferFrom.returns(true),
    wmatic.mock.balanceOf.withArgs(mimoProxy.address).returns(BORROW_AMOUNT),
    wmatic.mock.balanceOf.withArgs(leverage.address).returns(BORROW_AMOUNT),
    vaultsCore.mock.depositAndBorrow.returns(),
    dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    ),
    stablex.mock.allowance.returns(PAR_TO_SELL),
    stablex.mock.approve.returns(true),
    vaultsCore.mock.depositAndBorrow.returns(),
    vaultsCore.mock.deposit.returns(),
    addressProvider.mock.stablex.returns(stablex.address),
    addressProvider.mock.core.returns(vaultsCore.address),
  ]);

  // Fetch aggregator params
  const swapParams: OneInchSwapParams = {
    fromTokenAddress: "0xE2Aa7db6dA1dAE97C5f5C6914d285fBfCC32A128",
    toTokenAddress: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    amount: PAR_TO_SELL.toString(),
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
    leverage,
    priceFeed,
    stablex,
    data,
  };
});

describe("--- MIMOLeverage Unit Test ---", () => {
  it("should be able to leverage with deposit", async () => {
    const { mimoProxy, leverage, wmatic, owner, lendingPool, data } = await setup();
    const leverageData = [
      DEPOSIT_AMOUNT,
      PAR_TO_SELL,
      [wmatic.address, leverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const MIMOProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(leverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      leverage.address,
      [wmatic.address],
      [BORROW_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should be able to leverage without deposit", async () => {
    const { mimoProxy, leverage, wmatic, owner, lendingPool, data } = await setup();
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, leverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(leverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      leverage.address,
      [wmatic.address],
      [BORROW_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should revert if collateralBalance < flashloanAmount", async () => {
    const { mimoProxy, leverage, wmatic, owner, lendingPool, data } = await setup();
    await wmatic.mock.balanceOf.withArgs(mimoProxy.address).returns(0);
    const leverageData = [
      DEPOSIT_AMOUNT,
      PAR_TO_SELL,
      [wmatic.address, leverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const MIMOProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(leverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(leverage.address, [wmatic.address], [BORROW_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith("3");
  });
  it("should deposit remainingBalance in vault", async () => {
    const { mimoProxy, leverage, wmatic, owner, lendingPool, data } = await setup();
    await wmatic.mock.balanceOf.withArgs(mimoProxy.address).returns(BORROW_AMOUNT.mul(2));
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, leverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(leverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await lendingPool.executeOperation(
      leverage.address,
      [wmatic.address],
      [BORROW_AMOUNT],
      [0],
      mimoProxy.address,
      params,
    );
  });
  it("should revert if proxy or router address is address zero", async () => {
    const { mimoProxy, leverage, wmatic, owner, lendingPool, data, dexAddressProvider } = await setup();
    await dexAddressProvider.mock.getDex.returns(
      ethers.constants.AddressZero,
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
    );
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, leverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(leverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(leverage.address, [wmatic.address], [BORROW_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith("1");
    await dexAddressProvider.mock.getDex.returns(
      "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
      ethers.constants.AddressZero,
    );
    await expect(
      lendingPool.executeOperation(leverage.address, [wmatic.address], [BORROW_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith("1");
  });
  it("should revert if initiator is not mimoProxy", async () => {
    const { mimoProxy, leverage, wmatic, owner, lendingPool, data } = await setup();
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, leverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(leverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await expect(
      lendingPool.executeOperation(leverage.address, [wmatic.address], [BORROW_AMOUNT], [0], owner.address, params),
    ).to.be.revertedWith(`INITIATOR_NOT_AUTHORIZED("${owner.address}", "${mimoProxy.address}")`);
  });
  it("should revert if executeOperation is called by other than lending pool", async () => {
    const { mimoProxy, leverage, wmatic, owner, data, lendingPool } = await setup();
    const leverageData = [0, PAR_TO_SELL, [wmatic.address, leverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const MIMOProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await mimoProxy.execute(leverage.address, MIMOProxyData);
    const params = defaultAbiCoder.encode(
      ["address", "uint256", "tuple(uint256, bytes)"],
      [owner.address, PAR_TO_SELL, [1, data.tx.data]],
    );
    await expect(
      leverage.executeOperation([wmatic.address], [BORROW_AMOUNT], [0], mimoProxy.address, params),
    ).to.be.revertedWith(`CALLER_NOT_LENDING_POOL("${owner.address}", "${lendingPool.address}")`);
  });
});
