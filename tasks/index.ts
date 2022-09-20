import { readdirSync, readFileSync } from "fs";
import { task } from "hardhat/config";

const explorerLinks: Record<string, string> = {
  1: "https://etherscan.io/address/",
  250: "https://ftmscan.com/address/",
  137: "https://polygonscan.com/address/",
};

task("get-contract-links", "Prints deployed contracts chain explorer links")
  .addOptionalParam<string>("filterArg", "String to filter which contract(s) to get links for")
  .setAction(async (filterArg, hre) => {
    if (!hre.network.live) {
      console.log("Error: cannot only get links on live network");
      process.exit();
    }

    filterArg = filterArg.filterArg;
    const dir = readdirSync(`deployments/${hre.network.name}`);
    const chainId = await hre.getChainId();
    for (const file of dir) {
      if (file.includes(`${filterArg ? filterArg : ""}.json`)) {
        const contract = JSON.parse(readFileSync(`deployments/${hre.network.name}/${file}`).toString());
        const { address } = contract;
        const contractName = file.slice(0, -5);
        console.log(`${contractName} : ${explorerLinks[Number.parseInt(chainId)]}${address}#code`);
      }
    }
  });
