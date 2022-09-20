import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ADDRESSES, ChainId } from "../../config/addresses";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();
  const chainId = hre.network.live
    ? ((await hre.getChainId()) as ChainId)
    : process.env.FORK_ID
    ? (process.env.FORK_ID as ChainId)
    : ((await hre.getChainId()) as ChainId);

  const chainAddresses = ADDRESSES[chainId];
  const mimoProxyFactory = await hre.ethers.getContract("MIMOProxyFactory");

  await deploy("MIMOEmptyVault", {
    from: deployer,
    args: [
      chainAddresses.ADDRESS_PROVIDER,
      chainAddresses.DEX_ADDRESS_PROVIDER,
      chainAddresses.AAVE_POOL,
      mimoProxyFactory.address,
    ],
  });
};

export default func;
func.id = "deploy_mimo_empty_vault";
func.dependencies = ["MIMOProxyFactory"];
func.tags = ["Action", "MIMOEmptyVault"];
