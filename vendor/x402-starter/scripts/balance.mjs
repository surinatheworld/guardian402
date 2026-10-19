// Prints the USDC of the buyer and of the seller: `npm run balance`. Run it before and after `npm run pay`.
import { createPublicClient, erc20Abi, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NET, fromUnits } from "../src/networks.mjs";

const chain = createPublicClient({ chain: NET.chain, transport: http(NET.rpc) });
const usdc = (owner) => chain.readContract({ address: NET.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] });

const wallets = [];
if (/^0x[0-9a-fA-F]{64}$/.test(process.env.BUYER_PRIVATE_KEY || "")) wallets.push(["Buyer ", privateKeyToAccount(process.env.BUYER_PRIVATE_KEY).address]);
if (isAddress(process.env.PAY_TO || "")) wallets.push(["Seller", process.env.PAY_TO]);
if (!wallets.length) console.log("Set BUYER_PRIVATE_KEY and PAY_TO in .env.local first.");

console.log(`USDC on ${NET.name}`);
for (const [who, owner] of wallets) console.log(`${who}  ${owner}  ${fromUnits(await usdc(owner))} USDC`);
