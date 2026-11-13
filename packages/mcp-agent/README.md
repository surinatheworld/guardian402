# guardian402-mcp

MCP server that lets an AI agent pay from a [Guardian402](https://github.com/surinatheworld/guardian402)
AgentVault on Avalanche Fuji (testnet only). Each payment is checked and approved by the Guardian first; the
vault enforces the owner's rules on chain. If anything would be refused, nothing is sent.

Add it to any MCP client (the `mcpServers` format):

```json
{
  "mcpServers": {
    "guardian402": {
      "command": "npx",
      "args": ["-y", "guardian402-mcp"],
      "env": {
        "GUARDIAN_API_URL": "https://<dashboard>/api/agent/v1",
        "GUARDIAN_API_KEY": "g402_…",
        "AGENT_PK": "0x… (the agent wallet key)"
      }
    }
  }
}
```

The dashboard's Agent page gives the URL and the API key. The agent wallet key stays on the machine that runs the
agent; it signs the Guardian fee (x402, at most 0.02 USDC per call) and the vault transaction.

| Tool              | What it does                                                      | Cost       |
| ----------------- | ----------------------------------------------------------------- | ---------- |
| `get_rules`       | The vault's rules: recipients, daily and per-payment caps, budget | free       |
| `check_payment`   | Ask the Guardian about a payment without sending it               | 0.005 USDC |
| `pay`             | Guardian approval, then the vault executes it; or nothing is sent | 0.01 USDC  |
| `get_transaction` | The outcome of a vault transaction                                | free       |

Optional: `CHAIN_RPC_URL` (default: the public Fuji RPC). Node.js 22.13 or later. MIT license.
