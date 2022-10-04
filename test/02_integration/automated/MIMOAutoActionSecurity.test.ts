import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { ADDRESSES } from "../../../config/addresses";
import {
  AutoRebalanceSwapReentrancy,
  DexAddressProvider,
  IERC20,
  IVaultsDataProvider,
  MIMOAutoRebalance,
  MIMOProxy,
} from "../../../typechain";
import { getSelector, WAD } from "../../utils";
import { baseSetup } from "../baseFixture";

chai.use(solidity);
const chainAddresses = ADDRESSES["137"];

type AutoActionContracts = {
  mimoAutoRebalance: MIMOAutoRebalance;
  vaultsDataProvider: IVaultsDataProvider;
  usdc: IERC20;
  dexAddressProvider: DexAddressProvider;
  mimoProxy: MIMOProxy;
};

type AutoActionTestSigners = {
  owner1: SignerWithAddress;
  owner2: SignerWithAddress;
  attacker1: SignerWithAddress;
};

type AutoActionTestVaultData = {
  vaultId: BigNumber;
};

const setup = deployments.createFixture(
  async (): Promise<{
    testContracts: AutoActionContracts;
    testSigners: AutoActionTestSigners;
    vaultData: AutoActionTestVaultData;
  }> => {
    const {
      mimoAutoRebalance,
      vaultsDataProvider,
      priceFeed,
      usdc,
      mimoProxy,
      mimoProxyGuard,
      mimoVaultActions,
      mimoProxyActions,
      mimoRebalance,
      dexAddressProvider,
    } = await baseSetup();
    const [owner1, owner2, attacker1] = await ethers.getSigners();
    const testSigners: AutoActionTestSigners = { owner1, owner2, attacker1 };

    // Give the autoRebalance contract permission to rebalance
    await mimoProxy.execute(
      mimoProxyActions.address,
      mimoProxyActions.interface.encodeFunctionData("multicall", [
        [mimoProxyGuard.address],
        [
          mimoProxyGuard.interface.encodeFunctionData("setPermission", [
            mimoAutoRebalance.address,
            mimoRebalance.address,
            getSelector(
              mimoRebalance.interface.functions[
                "rebalanceOperation(address,uint256,uint256,uint256,(address,uint256,uint256),(uint256,bytes))"
              ].format(),
            ),
            true,
          ]),
        ],
      ]),
    );

    const testContracts: AutoActionContracts = {
      mimoAutoRebalance,
      vaultsDataProvider,
      usdc,
      dexAddressProvider,
      mimoProxy,
    };

    const depositAmount = WAD;
    const depositValue = await priceFeed.convertFrom(chainAddresses.WMATIC, depositAmount);
    const borrowAmount = depositValue.mul(100).div(255);

    // Get Vaultid of newly created vault
    await mimoProxy.execute(
      mimoVaultActions.address,
      mimoVaultActions.interface.encodeFunctionData("depositETHAndBorrow", [borrowAmount]),
      { value: depositAmount },
    );
    const vaultId = await vaultsDataProvider.vaultId(chainAddresses.WMATIC, mimoProxy.address);

    const vaultData = { vaultId };

    return {
      testContracts,
      testSigners,
      vaultData,
    };
  },
);

let testContracts: AutoActionContracts;
let testSigners: AutoActionTestSigners;
let vaultData: AutoActionTestVaultData;

describe("--- MIMOAutoAction contracts security ---", async () => {
  beforeEach(async () => {
    ({ testContracts, testSigners, vaultData } = await setup());
  });

  it("Should not allow setAutomation to be called on uninitialized vaults", async () => {
    const lastVaultId = await testContracts.vaultsDataProvider.vaultCount();

    const unitializedVaultId = lastVaultId.add(1);
    await expect(
      testContracts.mimoAutoRebalance.setAutomation(unitializedVaultId, {
        isAutomated: true,
        toCollateral: testContracts.usdc.address,
        allowedVariation: WAD,
        targetRatio: WAD.mul(3),
        triggerRatio: WAD.mul(2),
        mcrBuffer: WAD.div(10),
        fixedFee: WAD.div(100),
        varFee: WAD.div(1000),
      }),
    ).to.be.revertedWith(`VAULT_NOT_INITIALIZED(${unitializedVaultId})`);
  });

  it("AutoRebalance rebalance should not allow reentry", async () => {
    const { dexAddressProvider, mimoAutoRebalance } = testContracts;

    const swapData = {
      dexIndex: 999, // Use 999 as the index to allow tests to still work as new dexAPs are added
      dexTxData: "0x",
    };

    // Deploy a new dexAddressProvider that simulates a reentrancy attempt
    await deployments.deploy("AutoRebalanceSwapReentrancy", {
      from: testSigners.owner1.address,
      args: [mimoAutoRebalance.address, vaultData.vaultId, swapData],
    });

    const swapReentrancyAttackContract: AutoRebalanceSwapReentrancy = await ethers.getContract(
      "AutoRebalanceSwapReentrancy",
    );

    // Set dex mapping
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [chainAddresses.MULTISIG] });
    const multiSigSigner = await ethers.getSigner(chainAddresses.MULTISIG);
    await dexAddressProvider
      .connect(multiSigSigner)
      .setDexMapping(999, swapReentrancyAttackContract.address, swapReentrancyAttackContract.address);

    // Now try to re-enter rebalance
    await testContracts.mimoAutoRebalance.setAutomation(vaultData.vaultId, {
      isAutomated: true,
      toCollateral: testContracts.usdc.address,
      allowedVariation: WAD,
      targetRatio: WAD.mul(3),
      triggerRatio: WAD.mul(3),
      mcrBuffer: WAD.div(10),
      fixedFee: WAD.div(100),
      varFee: WAD.div(1000),
    });

    await expect(mimoAutoRebalance.rebalance(vaultData.vaultId, swapData)).to.be.revertedWith(
      "ReentrancyGuard: reentrant call",
    );
  });
});
