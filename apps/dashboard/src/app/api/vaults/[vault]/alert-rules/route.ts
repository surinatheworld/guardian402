// Alert rules. POST {name, kind: risk|rule|cap_usage, minRisk? | ruleId? | capPercent?, enabled?}.
import { readJson, vaultRoute } from "@/server/http";

export const GET = vaultRoute((ws, v) => ({ rules: ws.listAlertRules(v) }));
export const POST = vaultRoute(
  async (ws, v, _p, req) => ({ rule: ws.createAlertRule(v, await readJson(req)) }),
  201,
);
