// SQLite store (docs/SPEC.md §6.5) on node:sqlite. No IP addresses and no personal data.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Address } from "viem";
import type { CheckResponse } from "@guardian402/shared";

const MIGRATIONS = [
  `CREATE TABLE checks (
     checkId TEXT PRIMARY KEY, createdAt INTEGER NOT NULL, endpoint TEXT NOT NULL, vault TEXT NOT NULL,
     callsHash TEXT NOT NULL, risk TEXT NOT NULL, score INTEGER NOT NULL, findingsJson TEXT NOT NULL,
     diffJson TEXT NOT NULL, explanationJson TEXT NOT NULL, verdictJson TEXT, latencyMs INTEGER NOT NULL,
     demo INTEGER NOT NULL)`,
  `CREATE TABLE payments (
     id INTEGER PRIMARY KEY AUTOINCREMENT, createdAt INTEGER NOT NULL, payer TEXT, amount TEXT NOT NULL,
     txHash TEXT NOT NULL, endpoint TEXT NOT NULL, checkId TEXT)`,
  `CREATE INDEX checks_created ON checks (createdAt DESC)`,
  `ALTER TABLE checks ADD COLUMN simulationJson TEXT`,
];

export type CheckRow = {
  checkId: string;
  createdAt: number;
  endpoint: string;
  vault: string;
  risk: string;
  score: number;
  latencyMs: number;
  demo: boolean;
};

export type PaymentRow = {
  createdAt: number;
  payer: string | null;
  amount: string;
  txHash: string;
  endpoint: string;
  checkId: string | null;
};

export class Store {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

  #migrate() {
    this.#db.exec("CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY)");
    const done = new Set(
      (this.#db.prepare("SELECT id FROM migrations").all() as { id: number }[]).map((r) => r.id),
    );
    MIGRATIONS.forEach((sql, id) => {
      if (done.has(id)) return;
      this.#db.exec(sql);
      this.#db.prepare("INSERT INTO migrations (id) VALUES (?)").run(id);
    });
  }

  insertCheck(
    endpoint: string,
    vault: Address,
    callsHash: string,
    res: CheckResponse,
    createdAt = Date.now(),
  ) {
    this.#db
      .prepare(
        `INSERT INTO checks (checkId, createdAt, endpoint, vault, callsHash, risk, score, findingsJson, diffJson,
           explanationJson, verdictJson, latencyMs, demo, simulationJson)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        res.checkId,
        createdAt,
        endpoint,
        vault.toLowerCase(),
        callsHash,
        res.risk,
        res.score,
        JSON.stringify(res.findings),
        JSON.stringify(res.diff),
        JSON.stringify(res.explanation),
        res.verdict ? JSON.stringify(res.verdict) : null,
        Math.round(res.latencyMs),
        res.demoMode ? 1 : 0,
        JSON.stringify(res.simulation),
      );
  }

  insertPayment(p: Omit<PaymentRow, "createdAt">, createdAt = Date.now()) {
    this.#db
      .prepare(
        "INSERT INTO payments (createdAt, payer, amount, txHash, endpoint, checkId) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(createdAt, p.payer, p.amount, p.txHash, p.endpoint, p.checkId);
  }

  recentChecks(limit: number): CheckRow[] {
    const rows = this.#db
      .prepare(
        "SELECT checkId, createdAt, endpoint, vault, risk, score, latencyMs, demo FROM checks ORDER BY createdAt DESC LIMIT ?",
      )
      .all(limit) as (Omit<CheckRow, "demo"> & { demo: number })[];
    return rows.map((r) => ({ ...r, demo: r.demo === 1 }));
  }

  getCheck(checkId: string): (CheckRow & Record<string, unknown>) | undefined {
    const r = this.#db.prepare("SELECT * FROM checks WHERE checkId = ?").get(checkId) as
      Record<string, unknown> | undefined;
    if (!r) return undefined;
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : undefined);
    return {
      checkId: String(r.checkId),
      createdAt: Number(r.createdAt),
      endpoint: String(r.endpoint),
      vault: String(r.vault),
      risk: String(r.risk),
      score: Number(r.score),
      latencyMs: Number(r.latencyMs),
      demo: r.demo === 1,
      findings: parse(r.findingsJson),
      diff: parse(r.diffJson),
      explanation: parse(r.explanationJson),
      verdict: parse(r.verdictJson),
      simulation: parse(r.simulationJson),
      payment: this.#db
        .prepare("SELECT createdAt, payer, amount, txHash, endpoint FROM payments WHERE checkId = ?")
        .get(checkId),
    };
  }

  payments(limit: number): PaymentRow[] {
    return this.#db
      .prepare(
        "SELECT createdAt, payer, amount, txHash, endpoint, checkId FROM payments ORDER BY createdAt DESC LIMIT ?",
      )
      .all(limit) as PaymentRow[];
  }

  /** Addresses this vault has sent tokens to in LOW checks: an address-book source for the rules (SPEC §8). */
  paidRecipients(vault: Address): Address[] {
    const rows = this.#db
      .prepare(
        "SELECT diffJson FROM checks WHERE vault = ? AND risk = 'LOW' ORDER BY createdAt DESC LIMIT 200",
      )
      .all(vault.toLowerCase()) as { diffJson: string }[];
    const out = new Set<string>();
    for (const r of rows) {
      const diff = JSON.parse(r.diffJson) as { transfers: { from: string; to: string }[] };
      for (const t of diff.transfers) if (t.from.toLowerCase() === vault.toLowerCase()) out.add(t.to);
    }
    return [...out] as Address[];
  }

  stats() {
    const byRisk = Object.fromEntries(
      (
        this.#db.prepare("SELECT risk, COUNT(*) n FROM checks GROUP BY risk").all() as {
          risk: string;
          n: number;
        }[]
      ).map((r) => [r.risk, r.n]),
    );
    const pay = this.#db
      .prepare("SELECT COUNT(*) n, COALESCE(SUM(CAST(amount AS INTEGER)), 0) total FROM payments")
      .get() as { n: number; total: number };
    const lat = (
      this.#db.prepare("SELECT latencyMs FROM checks ORDER BY createdAt DESC LIMIT 500").all() as {
        latencyMs: number;
      }[]
    )
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    const pct = (p: number) =>
      lat.length ? (lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] ?? 0) : 0;
    return {
      checks: { LOW: byRisk.LOW ?? 0, MEDIUM: byRisk.MEDIUM ?? 0, HIGH: byRisk.HIGH ?? 0 },
      payments: { count: pay.n, totalAtomic: String(pay.total) },
      latencyMs: { p50: pct(50), p95: pct(95) },
    };
  }

  close() {
    this.#db.close();
  }
}
