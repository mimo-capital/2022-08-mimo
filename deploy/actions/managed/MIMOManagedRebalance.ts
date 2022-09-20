import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ADDRESSES, ChainId } from "../../../config/addresses";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();
  const chainId = hre.network.live
    ? ((await hre.getChainId()) as ChainId)
    : process.env.FORK_ID
    ? (process.env.FORK_ID as ChainId)
    : ((await hre.getChainId()) as ChainId);

  const chainAddresses = ADDRESSES[chainId];
  const mimoProxyFactory = await hre.deployments.get("MIMOProxyFactory");
  const mimoRebalance = await hre.deployments.get("MIMORebalance");

  await deploy("MIMOManagedRebalance", {
    from: deployer,
    args: [chainAddresses.ADDRESS_PROVIDER, chainAddresses.AAVE_POOL, mimoProxyFactory.address, mimoRebalance.address],
  });
};

export default func;
func.id = "deploy_mimo_managed_rebalance";
func.dependencies = ["MIMOProxyFactory", "MIMORebalance"];
func.tags = ["ManagedAction", "MIMOManagedRebalance"];
