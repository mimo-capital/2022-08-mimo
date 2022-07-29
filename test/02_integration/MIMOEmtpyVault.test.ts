import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { defaultAbiCoder } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import { ADDRESSES } from "../../config/addresses";
import { POLYGON_ENDPOINT } from "../../hardhat.config";
import {
  IAccessController,
  IAddressProvider,
  IERC20,
  IPriceFeed,
  ISTABLEX,
  IVaultsCore,
  IVaultsDataProvider,
  IWETH,
  MIMOProxy,
  MIMOProxyRegistry,
} from "../../typechain";
import { MIMOEmptyVault } from "../../typechain/MIMOEmptyVault";
import { MIMOVaultActions } from "../../typechain/MIMOVaultActions";
import { getOneInchTxData, getParaswapPriceRoute, getParaswapTxData, getSelector, OneInchSwapParams } from "../utils";

chai.use(solidity);

const DEPOSIT_AMOUNT = ethers.utils.parseEther("50");
const BORROW_AMOUNT = ethers.utils.parseEther("5");

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
  await deployments.fixture(["Proxy", "MIMOEmptyVault", "MIMOVaultActions"]);

  // Fetch contracts
  const addressProvider: IAddressProvider = await ethers.getContractAt(
    "IAddressProvider",
    chainAddresses.ADDRESS_PROVIDER,
  );

  const [vaultsCoreAddress, vaultsDataProviderAddress, accessControllerAddress, priceFeedAddress, stablexAddress] =
    await Promise.all([
      addressProvider.core(),
      addressProvider.vaultsData(),
      addressProvider.controller(),
      addressProvider.priceFeed(),
      addressProvider.stablex(),
    ]);

  const [
    vaultsCore,
    vaultsDataProvider,
    accessController,
    priceFeed,
    stablex,
    wmatic,
    usdc,
    mimoProxyRegistry,
    vaultActions,
    emptyVault,
  ] = (await Promise.all([
    ethers.getContractAt("IVaultsCore", vaultsCoreAddress),
    ethers.getContractAt("IVaultsDataProvider", vaultsDataProviderAddress),
    ethers.getContractAt("IAccessController", accessControllerAddress),
    ethers.getContractAt("IPriceFeed", priceFeedAddress),
    ethers.getContractAt("ISTABLEX", stablexAddress),
    ethers.getContractAt("IWETH", chainAddresses.WMATIC),
    ethers.getContractAt("IERC20", chainAddresses.USDC),
    ethers.getContract("MIMOProxyRegistry"),
    ethers.getContract("MIMOVaultActions"),
    ethers.getContract("MIMOEmptyVault"),
  ])) as [
    IVaultsCore,
    IVaultsDataProvider,
    IAccessController,
    IPriceFeed,
    ISTABLEX,
    IWETH,
    IERC20,
    MIMOProxyRegistry,
    MIMOVaultActions,
    MIMOEmptyVault,
  ];

  await mimoProxyRegistry.deploy();
  const deployedMIMOProxy = await mimoProxyRegistry.getCurrentProxy(owner.address);
  const mimoProxy: MIMOProxy = await ethers.getContractAt("MIMOProxy", deployedMIMOProxy);

  // Set permission on deployed MIMOProxy for MIMOEmptyVault callback
  await mimoProxy.setPermission(
    emptyVault.address,
    emptyVault.address,
    getSelector(
      emptyVault.interface.functions["emptyVaultOperation(address,uint256,uint256,(uint256,bytes))"].format(),
    ),
    true,
  );

  // Get WMATIC
  await wmatic.deposit({ value: DEPOSIT_AMOUNT });
  await wmatic.approve(mimoProxy.address, DEPOSIT_AMOUNT);

  // Open vault to be emptied
  const depositData = vaultActions.interface.encodeFunctionData("depositAndBorrow", [
    wmatic.address,
    DEPOSIT_AMOUNT,
    BORROW_AMOUNT,
  ]);
  await mimoProxy.execute(vaultActions.address, depositData);
  const vaultId = await vaultsDataProvider.vaultId(wmatic.address, mimoProxy.address);

  // Grant minter role to owner
  owner.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther("20") });

  const MINITER_ROLE = await accessController.MINTER_ROLE();
  await accessController.connect(multisig).grantRole(MINITER_ROLE, owner.address);

  return {
    owner,
    mimoProxy,
    vaultsCore,
    vaultsDataProvider,
    wmatic,
    emptyVault,
    priceFeed,
    stablex,
    usdc,
    vaultId,
    vaultActions,
    accessController,
  };
});

describe("--- MIMOEmtpyVault Integration Tests ---", () => {
  it("should be able to empty vault with 1inch", async () => {
    const { mimoProxy, emptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, emptyVault.address, flAmount], [1, data.tx.data]];
    const MIMOProxyData = emptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(emptyVault.address, MIMOProxyData);
    const receipt = await tx.wait(1);
    console.log("Empty vault 1inch gas used : ", receipt.gasUsed.toString());
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebtAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(vaultDebt).to.be.gt(ethers.constants.Zero);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.equal(ethers.constants.Zero);
    expect(vaultDebtAfter).to.be.equal(ethers.constants.Zero);
  });
  it("should be able to empty vault with paraswap", async () => {
    const { mimoProxy, emptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const pricesParams = {
      srcToken: wmatic.address,
      destToken: stablex.address,
      side: "SELL",
      network: 137,
      srcDecimals: 18,
      destDecimals: 18,
      amount: flAmount.toString(),
    };
    // Call Paraswap
    const routeData = await getParaswapPriceRoute(pricesParams);

    const bodyParams = {
      srcToken: wmatic.address,
      destToken: stablex.address,
      priceRoute: routeData.data.priceRoute,
      srcAmount: flAmount.toString(),
      slippage: 100, // 1% slippage
      userAddress: emptyVault.address,
    };

    // We now use the paraswap API to get the best route to sell the PAR we just loaned
    const { data } = await getParaswapTxData(bodyParams);
    const emptyVaultData = [vaultId, [wmatic.address, emptyVault.address, flAmount], [0, data.data]];
    const MIMOProxyData = emptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const tx = await mimoProxy.execute(emptyVault.address, MIMOProxyData);
    const receipt = await tx.wait(1);
    console.log("Empty vault paraswap gas used : ", receipt.gasUsed.toString());
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebtAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(vaultDebt).to.be.gt(ethers.constants.Zero);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.equal(ethers.constants.Zero);
    expect(vaultDebtAfter).to.be.equal(ethers.constants.Zero);
  });
  it("should be able to setPermission and empty vault in 1 tx", async () => {
    const { mimoProxy, emptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const emptyVaultSelector = getSelector(
      emptyVault.interface.functions["emptyVaultOperation(address,uint256,uint256,(uint256,bytes))"].format(),
    );
    await mimoProxy.setPermission(emptyVault.address, emptyVault.address, emptyVaultSelector, false);
    const permission = await mimoProxy.getPermission(emptyVault.address, emptyVault.address, emptyVaultSelector);
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, emptyVault.address, flAmount], [1, data.tx.data]];
    const MIMOProxyData = emptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    const collateralBalanceBefore = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    await mimoProxy.batch(
      [
        mimoProxy.interface.encodeFunctionData("setPermission", [
          emptyVault.address,
          emptyVault.address,
          emptyVaultSelector,
          true,
        ]),
        mimoProxy.interface.encodeFunctionData("execute", [emptyVault.address, MIMOProxyData]),
      ],
      true,
    );
    const collateralBalanceAfter = await vaultsDataProvider.vaultCollateralBalance(vaultId);
    const vaultDebtAfter = await vaultsDataProvider.vaultDebt(vaultId);
    expect(permission).to.be.false;
    expect(vaultDebt).to.be.gt(ethers.constants.Zero);
    expect(collateralBalanceBefore).to.be.equal(DEPOSIT_AMOUNT);
    expect(collateralBalanceAfter).to.be.equal(ethers.constants.Zero);
    expect(vaultDebtAfter).to.be.equal(ethers.constants.Zero);
  });
  it("should revert if flashloan cannot be repaid", async () => {
    const {
      mimoProxy,
      emptyVault,
      wmatic,
      priceFeed,
      stablex,
      vaultId,
      vaultsDataProvider,
      vaultActions,
      vaultsCore,
      owner,
    } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(101).div(100); // Account for slippage
    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, emptyVault.address, flAmount], [1, data.tx.data]];
    const MIMOProxyData = emptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await stablex.mint(mimoProxy.address, vaultDebt.mul(2));
    await stablex.mint(owner.address, ethers.utils.parseEther("4"));
    await stablex.approve(vaultsCore.address, ethers.utils.parseEther("4"));
    await vaultsCore.repay(vaultId, ethers.utils.parseEther("4"));
    await mimoProxy.execute(
      vaultActions.address,
      vaultActions.interface.encodeFunctionData("withdraw", [vaultId, ethers.utils.parseEther("45")]),
    );
    await expect(mimoProxy.execute(emptyVault.address, MIMOProxyData)).to.be.revertedWith("3");
  });
  it("should revert if no enough collateral flashloaned", async () => {
    const { mimoProxy, emptyVault, wmatic, priceFeed, stablex, vaultId, vaultsDataProvider } = await setup();
    const vaultDebt = await vaultsDataProvider.vaultDebt(vaultId);
    const vaultDebtInCollateral = await priceFeed.convertTo(wmatic.address, vaultDebt);
    const flAmount = vaultDebtInCollateral.mul(10); // Account for slippage

    const swapParams: OneInchSwapParams = {
      fromTokenAddress: wmatic.address,
      toTokenAddress: stablex.address,
      amount: flAmount.toString(),
      fromAddress: mimoProxy.address,
      slippage: 1,
      disableEstimate: true,
    };
    const { data } = await getOneInchTxData(swapParams);
    const emptyVaultData = [vaultId, [wmatic.address, emptyVault.address, flAmount], [1, data.tx.data]];
    const MIMOProxyData = emptyVault.interface.encodeFunctionData("executeAction", [
      defaultAbiCoder.encode(["uint256", "tuple(address,address,uint256)", "tuple(uint256,bytes)"], emptyVaultData),
    ]);
    await expect(mimoProxy.execute(emptyVault.address, MIMOProxyData)).to.be.reverted;
  });
});
