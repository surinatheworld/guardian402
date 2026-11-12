// Where this server reaches the Guardian API. The browser-facing GUARDIAN_URL (lib/config) is for browsers;
// the server prefers GUARDIAN_PROXY_URL, the same upstream as the /api/guardian rewrite (next.config.ts), so a
// deployment with the Guardian on another port works for both.
import { GUARDIAN_URL } from "@/lib/config";

export const guardianUpstream = () => (process.env.GUARDIAN_PROXY_URL || GUARDIAN_URL).replace(/\/$/, "");
