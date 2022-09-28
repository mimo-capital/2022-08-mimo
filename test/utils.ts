import axios from "axios";
import { BigNumber } from "ethers";
import { concat, hexlify, parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";

export type OneInchSwapParams = {
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  fromAddress: string;
  slippage: number;
  disableEstimate: boolean;
};

export type ParaswapRouteParams = {
  srcToken: string;
  destToken: string;
  side: string;
  network: number;
  srcDecimals: number;
  destDecimals: number;
  amount: string;
};

export type ParaswapSwapBody = {
  srcToken: string;
  destToken: string;
  priceRoute: ParaswapRouteParams;
  srcAmount: string;
  slippage: number;
  userAddress: string;
};

export type SwapData = {
  dexIndex: number;
  dexTxData: string;
};

export type RebalanceData = {
  toCollateral: string;
  vaultId: BigNumber;
  mintAmount: BigNumber;
};

export type FlashLoanData = {
  asset: string;
  proxyAction: string;
  amount: BigNumber;
};

// Get tx data for a oneInch swap
export const getOneInchTxData = async (params: OneInchSwapParams) => {
  const res = await axios.get(`https://api.1inch.exchange/v3.0/137/swap`, {
    params,
  });
  return res;
};

// Get price route for use in getParaswapTxData
export const getParaswapPriceRoute = async (params: ParaswapRouteParams) => {
  const res = await axios.get(`https://apiv5.paraswap.io/prices/`, {
    params,
  });
  return res;
};

// Get tx data for a Paraswap swap
export const getParaswapTxData = async (bodyParams: ParaswapSwapBody) => {
  const res = await axios.post(`https://apiv5.paraswap.io/transactions/137`, bodyParams, {
    params: {
      ignoreChecks: true,
    },
  });
  return res;
};

export const getSelector = (func: string) => {
  const bytes = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(func));
  return hexlify(concat([bytes, ethers.constants.HashZero]).slice(0, 4));
};

export const getLatestTimestamp = async () => {
  const latestBlock = await ethers.provider.getBlock("latest");
  return ethers.BigNumber.from(latestBlock.timestamp);
};

export const ZERO = parseEther("0");
export const WAD = ethers.utils.parseEther("1");
export const HALF_WAD = WAD.div(2);

// Multiply Big Numbers, A and B, while maintaining accuracy to 18 decimals
export function wadMulBN(A: BigNumber, B: BigNumber): BigNumber {
  // Divide by utils.ONE to keep the 18 decimals
  // Multiply before dividing to preserve decimals
  return HALF_WAD.add(A.mul(B)).div(WAD);
}

// Divide Big Numbers, A over B, while maintaining accuracy to 18 decimals
export function wadDivBN(A: BigNumber, B: BigNumber): BigNumber {
  const haflB = B.div(2);
  return haflB.add(A.mul(WAD)).div(B);
}
