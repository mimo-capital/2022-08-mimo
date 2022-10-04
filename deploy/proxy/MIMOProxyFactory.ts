import { deployments } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();

  const mimoProxyGuardBase = await deployments.get("MIMOProxyGuard");

  await deploy("MIMOProxyFactory", {
    from: deployer,
    args: [mimoProxyGuardBase.address],
    log: true,
  });
};

export default func;
func.id = "deploy_mimo_proxy_factory";
func.dependencies = ["MIMOProxyGuardBase"];
func.tags = ["Proxy", "MIMOProxyFactory"];
