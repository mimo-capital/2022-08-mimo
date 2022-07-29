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
  const mimoProxyRegistry = await hre.deployments.get("MIMOProxyRegistry");
  const mimoRebalance = await hre.deployments.get("MIMORebalance");

  await deploy("MIMOAutoRebalance", {
    from: deployer,
    args: [chainAddresses.ADDRESS_PROVIDER, chainAddresses.AAVE_POOL, mimoProxyRegistry.address, mimoRebalance.address],
  });
};

export default func;
func.id = "deploy_mimo_auto_rebalance";
func.dependencies = ["MIMOProxyRegistry", "MIMORebalance"];
func.tags = ["AutomatedAction", "MIMOAutoRebalance"];
