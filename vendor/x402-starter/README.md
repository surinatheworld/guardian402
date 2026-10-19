# Pay per request with x402 on Avalanche

x402 uses the HTTP status 402 Payment Required to charge for one request. The server names a price, the caller signs a USDC payment and asks again, and a facilitator puts the transfer on chain. There is no account, no API key and no checkout page, so a program or an AI agent can buy from another program.

The three roles are three small files: a seller (`src/server.mjs`), a buyer (`src/pay.mjs`) and, if you want one, your own facilitator (`src/facilitator.mjs`). Out of the box the project uses a facilitator that already runs on Avalanche, on Fuji and on the C-Chain.

## Run it
You need Node 22.9 or newer.

1. Install the packages.
2. Copy `.env.example` to `.env.local`.
3. Run `npm run new-wallet` and paste the `BUYER_PRIVATE_KEY=...` line it prints into `.env.local`.
4. Put a wallet address you own in `PAY_TO`, for example your Core address. This is the seller: the address that gets paid.
5. Get test USDC for the buyer's address at the [Circle faucet](https://faucet.circle.com). Choose Avalanche Fuji. The buyer needs no AVAX.
6. Start the seller. In a second terminal, run the buyer.

```bash
npm install
cp .env.example .env.local
npm run new-wallet
npm run server
npm run pay
```

The buyer prints what the seller asked for, then the answer it paid for and a link to the transaction (addresses and hash shortened here):

```
402 Payment Required: 0.001 USDC to 0xEC33...cdAb on Avalanche Fuji.
Signing with 0x6DC6...33D1 and asking again.
Status 200
{"network":"Avalanche Fuji","block":59352891,"baseFeeWei":"10","time":"2026-10-12T20:43:55.000Z"}
Paid. Transaction: https://testnet.snowtrace.io/tx/0x...
```

`npm run balance` prints the USDC of both wallets. Run it before and after.

## How one payment goes
1. The buyer asks for `GET /api/gas`. The seller answers 402 with a `PAYMENT-REQUIRED` header: 0.001 USDC, on Fuji, to `PAY_TO`.
2. The buyer signs a message that allows exactly that transfer and asks again with a `PAYMENT-SIGNATURE` header. It sends no transaction.
3. The seller asks the facilitator to check the signature, then runs the route.
4. The facilitator sends the transfer to the USDC contract and pays the gas. The answer goes back with a `PAYMENT-RESPONSE` header that holds the transaction hash.

## Run your own facilitator
The public facilitators are other people's services: free, with no promise to stay up, and they see every payment you take. To depend on nobody during a demo, run the one in this project.

1. Run `npm run new-wallet` again and put that key in `.env.local` as `FACILITATOR_PRIVATE_KEY`.
2. Send that address a little test AVAX from the [Core faucet](https://core.app/tools/testnet-faucet). It pays the gas of every payment.
3. Run `npm run facilitator` in its own terminal.
4. Set `FACILITATOR_URL=http://localhost:4022` in `.env.local` and start the seller again.

## Watch out
- **What has been run.** On 13 October 2026 the whole payment ran on a local copy of Fuji (an anvil fork, so the real USDC contract) with the facilitator in this project: the buyer's USDC went down by 0.001 and the seller's went up by 0.001. On real Fuji, both public facilitators checked a payment from an empty wallet and refused it for having no USDC, which is the right answer. A payment settled by a public facilitator on real Fuji has not been run yet, because the Circle faucet needs a person to pass its captcha. The default facilitator's own statistics (`/api/stats`) counted 185 settled USDC payments on Fuji that day.
- `NETWORK=mainnet` moves real USDC on the C-Chain. Stay on Fuji until you mean it.
- The buyer's key is in `.env.local` and a program signs with it without asking you. Use a wallet made for this and keep little in it. `MAX_PRICE_USDC` is the most it pays for one request.
- The route runs before the money moves: verify, then your code, then settle. If the route answers with an error, nobody is charged. Keep a paid route cheap to run, because a payment can still fail to settle after your code has done its work.
- One signed payment works once. Sending the same `PAYMENT-SIGNATURE` again is refused, because USDC remembers the number inside it.
- The price names the token contract, its name and its version (`price` in `src/networks.mjs`). The x402 library knows USDC on C-Chain mainnet but not on Fuji, so a plain `"$0.001"` fails on Fuji.
- The versions of the `@x402` packages are pinned to 2.28 in `package.json`. The library changes quickly, so read its release notes before you raise them.

## Where to look
- `src/server.mjs` is the seller: the list of paid routes with their prices, and the route itself.
- `src/pay.mjs` is the buyer: the spending limit, and a `fetch` that pays when it meets a 402.
- `src/facilitator.mjs` is the optional facilitator: the three addresses `/supported`, `/verify` and `/settle`.
- `src/networks.mjs` holds the two networks, the USDC contract on each and the helpers the three share.
- `scripts/new-wallet.mjs` makes a key, and `scripts/balance.mjs` reads the USDC of the buyer and the seller.

## Make it yours
- Add a paid route: one more line in the list in `src/server.mjs`, with its own price.
- Sell something worth paying for: an answer from an AI model, a row of data, a minute of a call.
- Make the buyer an AI agent: give it `payingFetch` as its way to call paid APIs. `MAX_PRICE_USDC` is the limit it cannot argue its way past.
- Move to your own L1: no public facilitator knows your chain, so run `src/facilitator.mjs` there and use a token that has `transferWithAuthorization` (EIP-3009).
- Switch facilitator by changing `FACILITATOR_URL`. Two that work on Avalanche are in `.env.example`.

To learn the protocol in depth, Avalanche Builder Hub has a free course: [x402 Payment Infrastructure](https://build.avax.network/academy/blockchain/x402-payment-infrastructure).
