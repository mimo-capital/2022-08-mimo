import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { MIMOProxy } from "../../typechain";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const [deployer] = await hre.getUnnamedAccounts();

  await deploy("MIMOProxyBase", {
    contract: "MIMOProxy",
    from: deployer,
    args: [],
  });

  const mimoProxyBase: MIMOProxy = await hre.ethers.getContract("MIMOProxyBase");
  await mimoProxyBase.initialize();
};

export default func;
func.id = "deploy_mimo_proxy_factory";
func.tags = ["Proxy", "MIMOProxyBase"];
