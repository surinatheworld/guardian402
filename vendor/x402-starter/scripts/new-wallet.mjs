// Prints a brand-new wallet for the buyer: `npm run new-wallet`.
//
// Why a new wallet instead of the one you already have?
// The key sits in a file on your disk and a program signs with it without asking you. A wallet made only
// for this, holding a few test USDC, has nothing worth stealing.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const key = generatePrivateKey();
const { address } = privateKeyToAccount(key);

console.log("Private key (put it in .env.local, never in git):");
console.log(`BUYER_PRIVATE_KEY=${key}`);
console.log("");
console.log("Address (send test USDC here):");
console.log(address);
console.log("");
console.log("Test USDC is free at https://faucet.circle.com (choose Avalanche Fuji and paste the address).");
