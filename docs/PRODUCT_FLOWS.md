# Guardian402 flows and proposed information architecture

Analysis baseline: `main` at `9bd568c`, pulled from `47905f0` on 2026-11-10.
This is a product proposal, not an implementation claim or a change to SPEC.
Keep the approved HeroUI v3 concept and dashboard design standard.

## Product direction agreed after concept review

The following is the intended next product model. It supersedes the earlier
proposal below where they differ; it is not implemented by this concept export.

- Connect an AI agent that already runs outside Guardian. Guardian does not host
  the agent's model, prompts, strategy, or scheduler.
- Use REST as the canonical integration surface. MCP should adapt the same API
  and authorization checks. Provide agent-scoped Guardian API credentials and a
  clear integration handoff; these credentials are distinct from LLM provider
  credentials and from wallet signing authority. x402, if retained, handles
  service payments separately.
- Make a policy a named, versioned resource: budgets, permitted assets,
  recipients, contracts/actions, approval limits, and Guardian-check conditions.
  Users create a policy and assign it to an agent.
- Proposed initial assignment semantics: one effective policy per agent, with
  independent daily spending counters when several agents share a policy.
  A vault-wide cap can additionally limit their combined spending. Changing a
  policy must not reset spending already incurred in the current period.
- Show effective permissions first. Editing produces a reviewable change;
  wallet confirmation is required for changes to on-chain authority. Record
  the policy version and activation state, and keep change history separate.
- Remove the misleading strategy selector from core onboarding. An optional
  task description can identify the external agent's purpose.

Implementation gaps: the current vault authorizes one agent address at a time,
with vault-level limits. The dashboard registry, policy-change drafts, and
x402 client do not yet implement reusable policies, per-agent enforcement,
policy assignments, or issued Guardian API keys. New rules must identify their
enforcement point; an API-only check must not be presented as a vault guarantee
when the agent can bypass it through direct execution.

## What changed

The pull added account authentication, wallet/vault linking, an account page,
and vault-scoped APIs for agents, contacts, policy changes, notifications and
Guardian check reviews. See README, docs/API.md and the corresponding account
and workspace commits. The workspace APIs largely lack matching pages/hooks.

The product has three participants: the vault owner, an autonomous agent using
the API/MCP integration, and a visitor exploring the public testnet demo.
The Guardian operator's global revenue is a separate concern from the owner's
workspace. Do not invent team permissions or an operator access role.

## Existing capabilities and important gaps

- `/tai-khoan` implements email/password and SIWE sign-in, profile, wallet links,
  vault links and security events. Email verification/password recovery are not
  established flows; there is no mailer yet.
- Multiple vaults can be linked to an account, but chain reads/events still use
  the configured `deployment.vault`. Scope all query keys, reads, mutations and
  navigation to the selected chain/vault before presenting a multi-vault UI.
- Registry agents have metadata/status, but the contract has one current agent.
  Changing registry status does not pause the vault. Strategies are metadata,
  not a deployed agent runner or strategy builder.
- Contacts expose live recipient/target flags. Saving a contact does not grant
  on-chain permission; granting permission is a separate owner transaction.
- `/kiem-tra` currently uses the free, unsigned DEMO check endpoint. It does not
  prove a paid x402/cosign/execution lifecycle by itself.
- Check history, agent attempts, x402 payments and Executed events are separate
  data sources. Correlate where evidence permits using checkId/txHash; absence
  of a matching event is not proof of a revert.
- Executed events include txHash/block/checkId/withVerdict/nonce. They alone do
  not establish exact token deltas; receipt/transfer-log enrichment or recorded
  balance evidence is needed for a universal actual-before/after presentation.
- Alert evaluation happens on GET notifications. Do not describe it as push,
  email, or a background monitoring service.

## Flow map

| Flow                | User action                                                    | Required interface                                            | Available foundation                                          |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Explore             | Enter without a wallet, choose S0–S6, inspect result           | Public demo launcher and execution detail                     | Agent control API, attempts, demo check, chain evidence       |
| Identify            | Register/login using email or SIWE                             | Sign-in, wallet-signature states, account settings            | `/api/auth/*`, `/api/account/*`, `/tai-khoan`                 |
| Select vault        | Prove owner wallet, link existing vault, select it             | Vault picker, link dialog, empty workspace                    | Account vault API and live owner check during linking         |
| Inspect vault       | View balances, owner, authorized agent, caps and pause         | Overview using the approved balance/agent/history composition | Chain reads and Guardian health                               |
| Maintain agents     | Register metadata, select authorized agent, retire/remove      | Agent registry and policy-change handoff                      | Workspace agents API, live agent flag, set_agent/revoke_agent |
| Maintain contacts   | Add full address, resolve lookalike conflict, grant permission | Address book, comparison dialog, separate allowlist action    | Contacts API and policy changes                               |
| Govern spending     | Draft a policy, review effect/warnings, sign, wait for receipt | Policy editor, confirmation, change history                   | Policy change API + owner wallet + receipt verification       |
| Inspect transaction | Understand calls, simulation, risk, explanation and verdict    | Check detail with explicit data source and lifecycle          | Guardian check/cosign API and check detail                    |
| Verify execution    | Match attempted/submitted/executed/reverted outcomes           | Activity ledger and execution evidence detail                 | Agent attempts and chain events/receipts                      |
| Review incident     | Investigate risk, annotate review, take an owner action        | Check review, notes, escalation and policy links              | Vault checks/review API and policy API                        |
| Monitor             | Set alert rules, inspect notifications, mark read              | Notifications inbox + alert-rule settings                     | Alert rules and notification API                              |
| Integrate           | Configure external agent to call Guardian                      | Optional integration guide, endpoint examples, service health | HTTP and MCP services, ERC-8004 identity                      |

## Proposed routes and navigation

Global pages:

- `/demo`: public, wallet-free testnet exploration. Running a scenario can spend
  test tokens or change testnet state; identify that before launch. S0 transfers
  1.5 USDC per run and exceeds the demo's 1 USDC verdict threshold.
- `/tai-khoan`: sign-in/profile, linked wallets and security events as tabs.
- `/vaults`: linked vault selector and link-existing-vault flow. A deploy-new-vault
  wizard is not supported by the account linking endpoint.

Selected-vault workspace (proposed URLs):

| Sidebar item | Route                      | Main content                                                                                 |
| ------------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| Overview     | `/vaults/[vault]`          | Approved two-card hero, caps, recent activity and outstanding incidents                      |
| Transactions | `/vaults/[vault]/activity` | Checks, executions and proven refusals as tabs/filters                                       |
| Agents       | `/vaults/[vault]/agents`   | Registry metadata and a distinct on-chain authorization indicator                            |
| Contacts     | `/vaults/[vault]/contacts` | Names/full addresses, lookalike checks and live allowlist flags                              |
| Policies     | `/vaults/[vault]/policies` | Caps, approval limits, verdict threshold, allowlists, pause/revoke and signed-change history |
| Alerts       | `/vaults/[vault]/alerts`   | Notification inbox with alert-rule settings in a tab                                         |

Detail pages: `/vaults/[vault]/checks/[checkId]` and
`/vaults/[vault]/transactions/[txHash]`. A check can have no transaction;
an execution can have no Guardian check. Cross-link verified relationships.
Keep compatible entry points for existing URLs during migration.

Keep `/kiem-tra` as a supported transaction-check entry point. Introduce a
human-readable transfer/swap form above the existing advanced calls JSON.
Show validation and prerequisites; enable paid cosign/submit controls only when
the integration actually supports that lifecycle.

Move `/doanh-thu` out of the owner's primary navigation. It currently reports
Guardian-wide revenue; label its scope as service/operator data, not as an
owner's per-vault spending. Per-vault billing requires appropriate data mapping.

## Independent state models

Never collapse these into one green/red status:

1. **Risk:** LOW / MEDIUM / HIGH, determined by rules. The LLM explains only.
2. **Guardian request:** validating / waiting / simulating / assessed / failed;
   cosign additionally returns a verdict with nonce/deadline. Display only stages
   observable from the current API; there is no established streaming stage feed.
3. **x402 payment:** payment required / authorizing / settled / error / free DEMO.
   A successful payment is not proof the vault executed the requested batch.
4. **Execution:** not submitted / submitted / confirmed success / reverted;
   unknown evidence must remain unknown.
5. **Policy change:** draft → submitted → confirmed or failed; draft → cancelled.
   Wallet rejection keeps the draft. Refresh a pending receipt before declaring
   success. Signing in to the account does not confer on-chain owner privileges.
6. **Review:** unreviewed / reviewed / false_positive / escalated. Reviews annotate
   a check; they cannot rewrite its risk or override a vault decision.

Guardian checks are conditional, not universal. A supported small allowlisted
batch without approvals can execute within policy without a verdict. Guardian
cosign returns the actual assessed risk; acceptance depends on the vault's
configured maximum risk, nonce, deadline, calls and static policy.

## Delivery order

1. Establish session + selected chain/vault context and owner capability checks;
   scope data access, cache keys and all wallet writes consistently.
2. Preserve the approved HeroUI shell/composition; implement overview, transaction
   detail and public demo around the three judging journeys in README.
3. Wire the new workspace APIs into agents, contacts and policies. Keep metadata
   actions distinct from transactions and reuse one change-confirmation pattern.
4. Add check reviews and alerts. Distinguish upstream unavailability from an
   empty list or zero balances; preserve local metadata during an outage.
5. Add optional integration/operator surfaces after the core owner journeys.

Acceptance for UI work: actual data, correct vault scope, full-address access,
read-only versus owner actions, disconnected/wrong-chain/session-expired states,
no linked vault, loading, empty, upstream failure, pending/failed receipt, mobile
and keyboard operation. Compare rendered pages with the approved concept when
browser access is available; a successful build does not prove visual fidelity.
