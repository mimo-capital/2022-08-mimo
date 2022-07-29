import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ADDRESSES, ChainId } from "../../config/addresses";
import { IAddressProvider } from "../../typechain";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();
  const chainId = hre.network.live
    ? ((await hre.getChainId()) as ChainId)
    : process.env.FORK_ID
    ? (process.env.FORK_ID as ChainId)
    : ((await hre.getChainId()) as ChainId);

  const chainAddresses = ADDRESSES[chainId];
  const addressProvider: IAddressProvider = await hre.ethers.getContractAt(
    "IAddressProvider",
    chainAddresses.ADDRESS_PROVIDER,
  );
  const vaultsCore = await addressProvider.core();
  const vaultsDataProvider = await addressProvider.vaultsData();
  const stablex = await addressProvider.stablex();

  await deploy("MIMOVaultActions", {
    from: deployer,
    args: [vaultsCore, vaultsDataProvider, stablex],
  });
};

export default func;
func.id = "deploy_mimo_rebalance";
func.tags = ["Action", "MIMOVaultActions"];
