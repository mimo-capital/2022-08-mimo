import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();

  await deploy("MIMOProxyActions", {
    from: deployer,
  });
};

export default func;
func.id = "deploy_mimo_empty_vault";
func.tags = ["Action", "MIMOProxyActions"];
