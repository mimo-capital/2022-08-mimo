import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import { ADDRESSES } from "../../config/addresses";
import { POLYGON_ENDPOINT } from "../../hardhat.config";
import {
  IAddressProvider,
  IPriceFeed,
  ISTABLEX,
  IVaultsCore,
  IVaultsDataProvider,
  IWETH,
  MIMOLeverage,
  MIMOProxy,
  MIMOProxyRegistry,
  MIMOVaultActions,
} from "../../typechain";
import { getOneInchTxData, getParaswapPriceRoute, getParaswapTxData, getSelector, OneInchSwapParams } from "../utils";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("20");
const BORROW_AMOUNT = ethers.utils.parseEther("10");

const setup = deployments.createFixture(async () => {
  const [owner] = await ethers.getSigners();
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

  // Deploy Proxy contracts
  await deployments.fixture(["Proxy", "MIMOLeverage", "MIMOVaultActions"]);

  // Fetch contracts
  const chainAddresses = ADDRESSES["137"];
  const addressProvider: IAddressProvider = await ethers.getContractAt(
    "IAddressProvider",
    chainAddresses.ADDRESS_PROVIDER,
  );
  const [vaultsCoreAddress, vaultsDataProviderAddress, priceFeedAddress, stablexAddress] = await Promise.all([
    addressProvider.core(),
    addressProvider.vaultsData(),
    addressProvider.priceFeed(),
    addressProvider.stablex(),
  ]);

  const [vaultsCore, vaultsDataProvider, priceFeed, stablex, wmatic, mimoProxyRegistry, vaultActions, leverage] =
    (await Promise.all([
      ethers.getContractAt("IVaultsCore", vaultsCoreAddress),
      ethers.getContractAt("IVaultsDataProvider", vaultsDataProviderAddress),
      ethers.getContractAt("IPriceFeed", priceFeedAddress),
      ethers.getContractAt("ISTABLEX", stablexAddress),
      ethers.getContractAt("IWETH", chainAddresses.WMATIC),
      ethers.getContract("MIMOProxyRegistry"),
      ethers.getContract("MIMOVaultActions"),
      ethers.getContract("MIMOLeverage"),
    ])) as [
      IVaultsCore,
      IVaultsDataProvider,
      IPriceFeed,
      ISTABLEX,
      IWETH,
      MIMOProxyRegistry,
      MIMOVaultActions,
      MIMOLeverage,
    ];

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

  // Set permission on deployed MIMOProxy for MIMOLeverage callback
  await mimoProxy.setPermission(
    leverage.address,
    leverage.address,
    getSelector(leverage.interface.functions["leverageOperation(address,uint256,uint256,(uint256,bytes))"].format()),
    true,
  );

  // Get WMATIC
  await wmatic.deposit({ value: DEPOSIT_AMOUNT });
  await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);

  return {
    owner,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    vaultActions,
    wmatic,
    leverage,
    priceFeed,
    stablex,
  };
});

describe("--- MIMOLeverage Integration Tests ---", () => {
  it("should be able to leverage with deposit through 1 inch", async () => {
    const { mimoProxy, leverage, wmatic, priceFeed, stablex, vaultsDataProvider } = await setup();
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, leverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    const vaultIdBefore = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const tx = await mimoProxy.execute(leverage.address, mimoProxyData);
    const receipt = await tx.wait(1);
    console.log("Leverage gas used : ", receipt.gasUsed.toString());
    const vaultIdAfter = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const collateralBalance = await vaultsDataProvider.vaultCollateralBalance(vaultIdAfter);
    expect(vaultIdBefore).to.be.equal(ethers.constants.Zero);
    expect(collateralBalance).to.be.gte(DEPOSIT_AMOUNT.add(BORROW_AMOUNT));
  });
  it("should be able to leverage without deposit through 1 inch", async () => {
    const { mimoProxy, leverage, wmatic, priceFeed, stablex, vaultsDataProvider, vaultActions } = await setup();
    await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);
    await mimoProxy.execute(
      vaultActions.address,
      vaultActions.interface.encodeFunctionData("deposit", [wmatic.address, DEPOSIT_AMOUNT]),
    );
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [0, parToSell, [wmatic.address, leverage.address, BORROW_AMOUNT], [1, data.tx.data]];
    const mimoProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(leverage.address, mimoProxyData);
    const receipt = await tx.wait(1);
    console.log("Leverage gas used : ", receipt.gasUsed.toString());
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.gte(DEPOSIT_AMOUNT.add(BORROW_AMOUNT));
  });
  it("should be able to leverage through paraswap", async () => {
    const { mimoProxy, leverage, wmatic, priceFeed, stablex, vaultsDataProvider } = await setup();
    await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const pricesParams = {
      srcToken: stablex.address,
      destToken: wmatic.address,
      side: "SELL",
      network: 137,
      srcDecimals: 18,
      destDecimals: 18,
      amount: parToSell.toString(),
    };

    // Call Paraswap
    const routeData = await getParaswapPriceRoute(pricesParams);

    const bodyParams = {
      srcToken: stablex.address,
      destToken: wmatic.address,
      priceRoute: routeData.data.priceRoute,
      srcAmount: parToSell.toString(),
      slippage: 100, // 1% slippage
      userAddress: leverage.address,
    };

    // We now use the paraswap API to get the best route to sell the PAR we just loaned
    const { data } = await getParaswapTxData(bodyParams);

    const leverageData = [DEPOSIT_AMOUNT, parToSell, [wmatic.address, leverage.address, BORROW_AMOUNT], [0, data.data]];
    const mimoProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    const vaultIdBefore = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const tx = await mimoProxy.execute(leverage.address, mimoProxyData);
    const receipt = await tx.wait(1);
    console.log("Leverage gas used : ", receipt.gasUsed.toString());
    const vaultIdAfter = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const collateralBalance = await vaultsDataProvider.vaultCollateralBalance(vaultIdAfter);
    expect(vaultIdBefore).to.be.equal(ethers.constants.Zero);
    expect(collateralBalance).to.be.gte(DEPOSIT_AMOUNT.add(BORROW_AMOUNT));
  });
  it("should be able to setPermission and leverage in 1 tx", async () => {
    const { mimoProxy, leverage, wmatic, priceFeed, stablex, vaultsDataProvider } = await setup();
    const leverageSelector = getSelector(
      leverage.interface.functions["leverageOperation(address,uint256,uint256,(uint256,bytes))"].format(),
    );
    await mimoProxy.setPermission(leverage.address, leverage.address, leverageSelector, false);
    const permission = await mimoProxy.getPermission(leverage.address, leverage.address, leverageSelector);
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(101).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, leverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    const vaultIdBefore = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    await mimoProxy.batch(
      [
        mimoProxy.interface.encodeFunctionData("setPermission", [
          leverage.address,
          leverage.address,
          leverageSelector,
          true,
        ]),
        mimoProxy.interface.encodeFunctionData("execute", [leverage.address, mimoProxyData]),
      ],
      true,
    );
    const vaultIdAfter = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);
    const collateralBalance = await vaultsDataProvider.vaultCollateralBalance(vaultIdAfter);
    expect(permission).to.be.false;
    expect(vaultIdBefore).to.be.equal(ethers.constants.Zero);
    expect(collateralBalance).to.be.gte(DEPOSIT_AMOUNT.add(BORROW_AMOUNT));
  });
  it("should revert if flashloan cannot be repaid", async () => {
    const { mimoProxy, leverage, wmatic, priceFeed, stablex } = await setup();
    await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(50).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, leverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await expect(mimoProxy.execute(leverage.address, mimoProxyData)).to.be.revertedWith("3");
  });
  it("should revert if trying to leverage above MCR", async () => {
    const { mimoProxy, leverage, wmatic, priceFeed, stablex } = await setup();
    await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);
    const parToSell = await priceFeed.convertFrom(wmatic.address, BORROW_AMOUNT.mul(201).div(100));
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: stablex.address,
      toTokenAddress: wmatic.address,
      amount: parToSell.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const leverageData = [
      DEPOSIT_AMOUNT,
      parToSell,
      [wmatic.address, leverage.address, BORROW_AMOUNT],
      [1, data.tx.data],
    ];
    const mimoProxyData = leverage.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(
        ["uint256", "uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"],
        leverageData,
      ),
    ]);
    await expect(mimoProxy.execute(leverage.address, mimoProxyData)).to.be.reverted;
  });
});
