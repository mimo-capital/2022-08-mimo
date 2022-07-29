import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();

  const mimoProxyFactory = await hre.deployments.get("MIMOProxyFactory");

  await deploy("MIMOProxyRegistry", {
    from: deployer,
    args: [mimoProxyFactory.address],
    log: true,
  });
};

export default func;
func.id = "deploy_mimo_proxy_registry";
func.dependencies = ["MIMOProxyFactory"];
func.tags = ["Proxy", "MIMOProxyRegistry"];
