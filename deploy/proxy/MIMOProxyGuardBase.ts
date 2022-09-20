import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();

  await deploy("MIMOProxyGuard", {
    from: deployer,
    args: [],
    log: true,
  });
};

export default func;
func.id = "deploy_mimo_proxy_factory";
func.tags = ["Proxy", "MIMOProxyGuardBase"];
