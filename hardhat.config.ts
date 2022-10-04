import * as dotenv from "dotenv";

import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import { HardhatUserConfig, task } from "hardhat/config";
import "solidity-coverage";
import "./tasks";

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

const RINKEBY_ENDPOINT = `https://rinkeby.infura.io/v3/${process.env.INFURA_TOKEN}`;
const KOVAN_ENDPOINT = `https://kovan.infura.io/v3/${process.env.INFURA_TOKEN}`;
const GOERLI_ENDPOINT = `https://goerli.infura.io/v3/${process.env.INFURA_TOKEN}`;
export const MAINNET_ENDPOINT = `https://mainnet.infura.io/v3/${process.env.INFURA_TOKEN}`;
export const POLYGON_ENDPOINT = process.env.INFURA_TOKEN
  ? `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_TOKEN}`
  : "https://polygon-rpc.com/";
const MUMBAI_ENDPOINT = `https://polygon-mumbai.infura.io/v3/${process.env.INFURA_TOKEN}`;
const FANTOM_TESTNET_ENDPOINT = `https://rpc.testnet.fantom.network/`;
export const FANTOM_MAINNET_ENDPOINT = `https://rpc.ftm.tools/`;

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.10",
    settings: {
      optimizer: {
        enabled: true,
      },
    },
  },
  networks: {
    ropsten: {
      url: process.env.ROPSTEN_URL || "",
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    hardhat: {
      mining: {
        auto: true,
      },
      saveDeployments: false,
    },
    ganache: {
      url: "http://127.0.0.1:7545",
      chainId: 1337,
      loggingEnabled: true,
    },
    mainnet: {
      url: MAINNET_ENDPOINT,
      chainId: 1,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 40000000000,
    },
    rinkeby: {
      url: RINKEBY_ENDPOINT,
      chainId: 4,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      gasMultiplier: 1.2,
      loggingEnabled: true,
    },
    goerli: {
      url: GOERLI_ENDPOINT,
      chainId: 5,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    kovan: {
      url: KOVAN_ENDPOINT,
      chainId: 42,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      saveDeployments: true,
    },
    polygon: {
      url: POLYGON_ENDPOINT,
      chainId: 137,
      gasPrice: 150000000000, // 50 gwei
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    mumbai: {
      url: MUMBAI_ENDPOINT,
      chainId: 80001,
      gasPrice: 5000000000, // 50 gwei
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    fantommainnet: {
      url: FANTOM_MAINNET_ENDPOINT,
      chainId: 250,
      gasPrice: 200000000000,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      loggingEnabled: true,
    },
    fantomtestnet: {
      url: FANTOM_TESTNET_ENDPOINT,
      chainId: 4002,
      gasPrice: 900000000000,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      loggingEnabled: true,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY ? process.env.ETHERSCAN_API_KEY : "",
      polygon: process.env.POLYGONSCAN_API_KEY ? process.env.POLYGONSCAN_API_KEY : "",
      opera: process.env.FTMSCAN_API_KEY ? process.env.FTMSCAN_API_KEY : "",
      kovan: process.env.ETHERSCAN_API_KEY ? process.env.ETHERSCAN_API_KEY : "",
      rinkeby: process.env.ETHERSCAN_API_KEY ? process.env.ETHERSCAN_API_KEY : "",
    },
  },
  mocha: {
    timeout: 12000000000,
  },
};

export default config;
