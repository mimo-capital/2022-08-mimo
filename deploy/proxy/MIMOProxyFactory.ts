import { deployments } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();

  const mimoProxyBase = await deployments.get("MIMOProxyBase");

  await deploy("MIMOProxyFactory", {
    from: deployer,
    args: [mimoProxyBase.address],
    log: true,
  });
};

export default func;
func.id = "deploy_mimo_proxy_factory";
func.dependencies = ["MIMOProxyBase"];
func.tags = ["Proxy", "MIMOProxyFactory"];
