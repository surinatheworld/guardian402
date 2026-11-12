# Dashboard backend API

The dashboard (`apps/dashboard`, `pnpm dev:dashboard`; pages **Tài khoản** `/tai-khoan`, **Quy tắc chi tiêu** `/quy-tac`, **Agent** `/agent` and **Hoạt động** `/hoat-dong`) has a small backend: Next.js route handlers on its own
SQLite file (`ACCOUNT_DB`, default `apps/dashboard/data/accounts.db`). It holds off-chain identity and the owner's
metadata around a vault. The Guardian API (`apps/guardian`, SPEC §6) is a separate service and is unchanged.

Principles:

- **The chain is the authority.** Ownership, the current agent, allowlists, caps and balances are read live from
  the AgentVault. Nothing here can change them; policy changes are prepared here and signed by the owner's wallet.
- **Never stored:** private keys, seed phrases, signatures, balances, on-chain policy state, API keys (only
  their sha256). No IP addresses. A saved policy is the owner's intent; whether it is in force is always read
  from the chain.
- **Scoped:** every `/api/vaults/:vault/…` call needs a session and a vault linked to that account; anything else
  is `404`. Every write must come from the dashboard's own origin (`Origin` header), else `403`.

Errors are JSON `{ "error": "<code>", "message": "<Vietnamese text>" }` with the HTTP status. Amounts are
strings in base units (USDC: 6 decimals). Code: `apps/dashboard/src/server/` (rules), `src/app/api/` (routes).

## Auth and account

| Method and path                        | Body                                   | Notes                                                                                                                                                                   |
| -------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register`              | `{email, password, displayName?}`      | password ≥ 10 chars, scrypt; signs in (`201`)                                                                                                                           |
| `POST /api/auth/login`                 | `{email, password}`                    | same error for unknown email and wrong password; 10 tries / 15 min                                                                                                      |
| `POST /api/auth/logout`                | `{}`                                   | ends this session                                                                                                                                                       |
| `GET /api/auth/me`                     |                                        | user, wallets, linked vaults, last 20 security events, session method                                                                                                   |
| `POST /api/auth/siwe/nonce`            |                                        | `{nonce, chainId}`; single use, 5 minutes                                                                                                                               |
| `POST /api/auth/siwe/verify`           | `{message, signature}`                 | EIP-4361 message for this host, chain 43113. Unknown wallet → new account; signed in → wallet linked; a wallet belongs to one account                                   |
| `PATCH /api/account/profile`           | `{displayName?, locale?}`              |                                                                                                                                                                         |
| `POST /api/account/password`           | `{password, currentPassword?, email?}` | add email + password to a wallet-only account, or change it; ends the other sessions                                                                                    |
| `DELETE /api/account/wallets/:address` |                                        | refused for the last way to sign in                                                                                                                                     |
| `POST /api/account/vaults`             | `{address, label?}`                    | the vault's on-chain `owner()` must be one of your wallets; after an on-chain ownership change the link moves to the new owner and the old owner's workspace is deleted |
| `DELETE /api/account/vaults/:address`  |                                        | deletes the vault's workspace too; nothing changes on chain                                                                                                             |

## Vault workspace: `/api/vaults/:vault/…`

### Agents

| Method and path     | Body                                                      | Rules                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET agents`        |                                                           | `{onChainAgent, agents[]}`, each with `isOnChainAgent` (live `agent()`)                                                                                                                                                           |
| `POST agents`       | `{name, address, description?}`                           | not the vault, not zero, never one of your own wallets (owner key ≠ agent key); unique per vault; max 20. `description` is the agent's task in the owner's words (Guardian does not run agents; the old `strategy` field is gone) |
| `PATCH agents/:id`  | `{name?, description?, status?: active\|paused\|retired}` | address is immutable. `paused` and `retired` stop the agent API for this agent; they do not change the vault                                                                                                                      |
| `DELETE agents/:id` |                                                           | `409 agent_active_on_chain` while it is the vault's agent: revoke it first                                                                                                                                                        |

### Contacts (address book)

| Method and path       | Body                                                                                   | Rules                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET contacts`        |                                                                                        | each with live `allowlisted: {recipient, target}`                                                                                                                                                                                   |
| `POST contacts`       | `{name, address, kind?: recipient\|router\|treasury\|other, note?, confirmLookalike?}` | `409 lookalike` when the first and last 3 hex characters match a trusted address (another contact, a known contract, your wallets, the vault) but the address differs; send `confirmLookalike: true` to override (audited). Max 200 |
| `PATCH contacts/:id`  | `{name?, kind?, note?}`                                                                | address is immutable (delete and re-add, so the lookalike check runs again)                                                                                                                                                         |
| `DELETE contacts/:id` |                                                                                        |                                                                                                                                                                                                                                     |

### Policy changes (owner actions, signed in the wallet)

`draft → submitted → confirmed | failed`, or `draft → cancelled`.

| Method and path                  | Body                    | Rules                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET policy-changes`             |                         | last 100                                                                                                                                                                                                                 |
| `POST policy-changes`            | `{kind, params, note?}` | returns `transaction: {to: vault, data, value: "0"}` for the owner's wallet, plus `warnings` for weakening changes                                                                                                       |
| `GET policy-changes/:id`         |                         | re-verifies a `submitted` change on chain                                                                                                                                                                                |
| `PATCH policy-changes/:id`       | `{params?, note?}`      | drafts only; calldata rebuilt                                                                                                                                                                                            |
| `DELETE policy-changes/:id`      |                         | cancels a draft                                                                                                                                                                                                          |
| `POST policy-changes/:id/submit` | `{txHash}`              | the tx must exist, go to this vault, carry exactly the prepared calldata, and come from one of your wallets; success → `confirmed`, reverted → `failed`, not mined yet → `submitted`. A tx hash confirms one change only |

| `kind`                             | `params`                                                    | Vault call                                                                         |
| ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pause` / `unpause`                |                                                             | `pause()` / `unpause()`                                                            |
| `set_agent`                        | `{agent}`                                                   | `setAgent(agent)`; warns if it is one of your wallets                              |
| `revoke_agent`                     |                                                             | `setAgent(0x0)`                                                                    |
| `allow_recipient` / `allow_target` | `{address, allowed}`                                        | `setAllowedRecipient` / `setAllowedTarget`                                         |
| `allow_selector`                   | `{target, selector, allowed}` (selector: 4 bytes)           | `setAllowedSelector` (drafted when a policy is applied)                            |
| `token_policy`                     | `{token, tracked, dailyCap, maxApproval, verdictThreshold}` | `setTokenPolicy`; warns if the threshold exceeds the cap or the token is untracked |
| `native_policy`                    | `{dailyCap, verdictThreshold}`                              | `setNativePolicy`                                                                  |
| `max_agent_risk`                   | `{risk: 0..2}`                                              | `setMaxAgentRisk`; warns above 0                                                   |

Withdrawals and `ownerExecute` are deliberately not here: moving funds stays a direct owner action in the wallet.

Changes drafted to apply a policy assignment carry `assignmentId`.

### Policies and assignments

A **policy** is a named, versioned set of permissions and limits, owned by the user and reusable on any of their
vaults. Its `spec` (`src/lib/policy-spec.ts`) maps one to one onto AgentVault state, so once applied the vault
enforces it whether or not the agent uses the Guardian API:

```json
{
  "tokens": [
    { "token": "0x5425…Bc65", "dailyCap": "100000000", "maxApproval": "0", "verdictThreshold": "10000000" }
  ],
  "native": { "dailyCap": "0", "verdictThreshold": "0" },
  "recipients": ["0x…supplier", "0x…treasury"],
  "spenders": [],
  "contracts": [{ "address": "0x…router", "selectors": ["0x…"] }],
  "maxRisk": 0
}
```

Budgets are per token per UTC day and count the vault's balance decrease (shared by the whole vault). Tracked
tokens that a policy does not list are locked at 0 when it is applied. Recipients and spenders share one on-chain
list (`allowedRecipient`), so a spender can also receive transfers; the builder says so.

| Method and path              | Body                                                                   | Rules                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/policies[?vault=]` |                                                                        | the user's policies with the latest version, its `summary` and `warnings`, and current assignments; `vault` names addresses from that vault's address book                                                                                                        |
| `POST /api/policies`         | `{name, description?, template?: payments\|swap\|custom, spec, note?}` | version 1; names unique per user (case-insensitive); max 30 active                                                                                                                                                                                                |
| `GET /api/policies/:id`      |                                                                        | plus every version                                                                                                                                                                                                                                                |
| `PATCH /api/policies/:id`    | `{name?, description?, spec?, note?}`                                  | a different `spec` makes a new version (`newVersion`); assigned agents keep their version until moved                                                                                                                                                             |
| `DELETE /api/policies/:id`   |                                                                        | archives; `409 in_use` while an agent is assigned to it                                                                                                                                                                                                           |
| `GET assignments`            |                                                                        | every agent of the vault with its current assignment and `enforcement`: `active` (the vault matches the version and the agent is `agent()`), `pending` (with the plan and draft counts) or `unknown` (chain unreadable); plus today's budgets read from the vault |
| `POST assignments`           | `{agentId, policyId, version?}`                                        | one current assignment per agent (the previous one ends and its unsent drafts are cancelled); not for retired agents                                                                                                                                              |
| `GET assignments/:id`        |                                                                        | the plan: owner transactions that make the vault match, removals first and `set_agent` last, with `blockers` and `notes`                                                                                                                                          |
| `POST assignments/:id/apply` |                                                                        | drafts the plan as policy changes (replacing unsent drafts of this assignment); `409 changes_pending` while one is submitted                                                                                                                                      |
| `DELETE agents/:id/policy`   |                                                                        | ends the agent's assignment; the vault is unchanged (revoke the agent to stop execution)                                                                                                                                                                          |

### Agent API keys

| Method and path                 | Body      | Rules                                                                                               |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `GET agents/:id/keys`           |           | name, prefix, created, last used, revoked; never the key                                            |
| `POST agents/:id/keys`          | `{name?}` | `{key, apiKey}`: the key (`g402_…`) is returned only here; only its sha256 is stored. Max 5 active  |
| `DELETE agents/:id/keys/:keyId` |           | revokes (stops the agent API; the agent's wallet authority on the vault is a separate owner action) |

## Agent API: `/api/agent/v1/…`

For the agent's own software (any model or framework; an MCP server can adapt it). `Authorization: Bearer g402_…`,
no cookies, 120 requests per minute per key. A key identifies one agent of one vault and can never change a policy,
a limit or a permission.

| Method and path          | Rules                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET me`                 | the agent, its vault, `isOnChainAgent`, `vaultPaused`, `rules` read from the vault on chain (per asset: daily cap and what is left today, `maxPerTx`, `budget` and `budgetLeft`, the approval threshold; allowed recipients and apps with the owner's names; `maxRisk`) and `guideline`: the same rules as plain English sentences for an LLM agent. The vault is the rule book; no off-chain policy is needed |
| `POST check`             | `{calls, lang?}`; `vault` defaults to the agent's and may not name another (`403 wrong_vault`); forwarded to the Guardian's paid `/v1/check`                                                                                                                                                                                                                                                                   |
| `POST cosign`            | the same, and `409 not_vault_agent` unless the key's agent is the vault's `agent()` on chain (`503 chain_unavailable` when the vault cannot be read); forwarded to `/v1/cosign`                                                                                                                                                                                                                                |
| `GET checks/:checkId`    | a Guardian check of this vault (`404` for other vaults); the verdict comes without its signature (only the paid `cosign` response carries it), and a paid check appears once its payment settled                                                                                                                                                                                                               |
| `GET transactions/:hash` | `state`: `not_found`, `pending`, `reverted`, `executed` (the vault's `Executed` event: `checkId`, `withVerdict`, `nonce`) or `confirmed_without_execution`; plus `toVault` and `fromAgent`                                                                                                                                                                                                                     |

x402 passes through: without a payment, the Guardian's `402` and `PAYMENT-REQUIRED` reach the agent, whose x402
client (`@x402/fetch` with the agent wallet) retries with `PAYMENT-SIGNATURE`; `PAYMENT-RESPONSE` comes back. The
dashboard never holds or signs a payment and does not forward the API key to the Guardian. A `paused` or `retired`
agent gets `403 agent_not_active`. `503` with `Retry-After` means the Guardian is busy or could not simulate the
batch: nothing was scored, signed or charged; ask again after the given seconds.

### Agent MCP server (`pnpm mcp:agent`)

The same API as MCP tools, for an agent that speaks MCP. It runs next to the agent (stdio) with
`GUARDIAN_API_URL` (this API's base URL), `GUARDIAN_API_KEY` and `AGENT_PK`; both keys stay in that process.

| Tool              | What it does                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_rules`       | `GET me`: the guideline and the rules. Free                                                                                                                                                                                        |
| `check_payment`   | `POST check` for `{to, amount, token}` (USDC or AVAX) or raw `calls`; nothing is sent. 0.005 USDC                                                                                                                                  |
| `pay`             | `POST cosign`, then `AgentVault.executeBatch` from the agent wallet when the risk is within the owner's maximum and the vault's own simulation passes; otherwise `outcome: "blocked"` with the reasons and nothing sent. 0.01 USDC |
| `get_transaction` | `GET transactions/:hash`. Free                                                                                                                                                                                                     |

### Alerts and notifications

| Method and path                                    | Body                                                                                                                                           | Rules                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET alert-rules` · `POST alert-rules`             | `{name, kind, enabled?}` + `minRisk: MEDIUM\|HIGH` (`risk`), `ruleId` (`rule`, e.g. `ADDRESS_POISONING`) or `capPercent: 1..100` (`cap_usage`) | max 20 per vault                                                                                                                                                                                                                                                                                 |
| `PATCH alert-rules/:id` · `DELETE alert-rules/:id` | `{name?, enabled?, minRisk?, ruleId?, capPercent?}`                                                                                            | the kind is immutable                                                                                                                                                                                                                                                                            |
| `GET notifications[?unread=1]`                     |                                                                                                                                                | evaluates the rules first, then lists (last 100). `risk`/`rule` rules match the vault's Guardian checks made after the rule was created, once per check; `cap_usage` reads today's on-chain usage of USDC, once per day. `sync: {created, guardian, chain}` reports an outage instead of failing |
| `POST notifications/read`                          | `{ids: number[]}` or `{all: true}`                                                                                                             |                                                                                                                                                                                                                                                                                                  |

### Guardian checks and reviews

| Method and path                 | Body                                                   | Rules                                                                                                        |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `GET checks[?limit=]`           |                                                        | the vault's recent Guardian checks, each with `review`; `503 guardian_unavailable` when the Guardian is down |
| `PUT checks/:checkId/review`    | `{status: reviewed\|false_positive\|escalated, note?}` | the check must belong to this vault; a LOW check cannot be a `false_positive`                                |
| `DELETE checks/:checkId/review` |                                                        |                                                                                                              |

## Tests

`pnpm --filter @guardian402/dashboard test`: `test/accounts.test.ts` (auth, sessions, SIWE, vault links, route
handlers), `test/workspace.test.ts` (the five workspace modules, with a fake chain and a fake Guardian) and
`test/policies.test.ts` (policy spec, summary, "Thử policy", the plan of owner transactions, versions,
assignments, API keys and the agent API).
