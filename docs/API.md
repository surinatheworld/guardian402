# Dashboard backend API

The dashboard (`apps/dashboard`, `pnpm dev:dashboard`; pages **Tài khoản** `/tai-khoan` and **Quản lý vault** `/quan-ly`) has a small backend: Next.js route handlers on its own
SQLite file (`ACCOUNT_DB`, default `apps/dashboard/data/accounts.db`). It holds off-chain identity and the owner's
metadata around a vault. The Guardian API (`apps/guardian`, SPEC §6) is a separate service and is unchanged.

Principles:

- **The chain is the authority.** Ownership, the current agent, allowlists, caps and balances are read live from
  the AgentVault. Nothing here can change them; policy changes are prepared here and signed by the owner's wallet.
- **Never stored:** private keys, seed phrases, signatures, balances, policy. No IP addresses.
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

| Method and path     | Body                                                                 | Rules                                                                                                    |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET agents`        |                                                                      | `{onChainAgent, agents[]}`, each with `isOnChainAgent` (live `agent()`)                                  |
| `POST agents`       | `{name, address, description?, strategy?: dca\|payments\|custom}`    | not the vault, not zero, never one of your own wallets (owner key ≠ agent key); unique per vault; max 20 |
| `PATCH agents/:id`  | `{name?, description?, strategy?, status?: active\|paused\|retired}` | address is immutable                                                                                     |
| `DELETE agents/:id` |                                                                      | `409 agent_active_on_chain` while it is the vault's agent: revoke it first                               |

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
| `token_policy`                     | `{token, tracked, dailyCap, maxApproval, verdictThreshold}` | `setTokenPolicy`; warns if the threshold exceeds the cap or the token is untracked |
| `native_policy`                    | `{dailyCap, verdictThreshold}`                              | `setNativePolicy`                                                                  |
| `max_agent_risk`                   | `{risk: 0..2}`                                              | `setMaxAgentRisk`; warns above 0                                                   |

Withdrawals and `ownerExecute` are deliberately not here: moving funds stays a direct owner action in the wallet.

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
handlers) and `test/workspace.test.ts` (the five workspace modules, with a fake chain and a fake Guardian).
