"use client";
// Bắt đầu: the guided way from an empty account to an agent that can pay. Six steps, each one decision:
//   1 Ví chủ      the owner's wallet (connected, on Fuji, linked to the account, with gas)
//   2 Agent       the agent's own wallet (pasted, or generated here and shown once)
//   3 Quy tắc     who the agent may pay and how much: per day, per transaction, in total; the risk accepted
//   4 Tạo két     one transaction (VaultFactory.createVault), then the vault is linked, the agent registered
//                 and an API key issued
//   5 Nạp tiền    USDC into the vault; gas and Guardian fees to the agent's wallet
//   6 Kết nối     the API key and the MCP config for the agent
import { ArrowLeft, ArrowRight, CircleCheckFill } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Card } from "@heroui/react/card";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ProgressBar } from "@heroui/react/progress-bar";
import { Spinner } from "@heroui/react/spinner";
import { TextField } from "@heroui/react/textfield";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { parseEventLogs, type Address, type Hex } from "viem";
import { useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { vaultFactoryAbi } from "@guardian402/shared";
import { ApiKeyReveal, McpSetup } from "@/components/connect-agent";
import { AgentFeeForm, DepositForm } from "@/components/fund";
import { errorOf } from "@/components/form";
import {
  AgentStep,
  agentStepReady,
  OwnerStep,
  ReviewSummary,
  RulesStep,
  rulesStepReady,
  useOwnerReady,
} from "@/components/setup-steps";
import { TxStatus } from "@/components/tx-status";
import { ErrorBox, Notice } from "@/components/ui";
import { accountApi, useRefreshMe } from "@/lib/account";
import { deployment, NETWORK } from "@/lib/config";
import { DEFAULT_DRAFT, filledRecipients, vaultConfig, type SetupDraft } from "@/lib/setup";
import { useTx } from "@/lib/tx";
import { useSelectedVault } from "@/lib/vault-context";
import { wsApi } from "@/lib/workspace";

const STEPS = [
  { title: "Ví chủ", lead: "Ví của bạn là chủ két: chỉ nó rút được tiền và đổi được quy tắc." },
  { title: "Agent", lead: "Agent của bạn cần một ví riêng để ký giao dịch." },
  { title: "Quy tắc", lead: "Agent chỉ chi được trong những giới hạn này. Đổi lại được bất cứ lúc nào." },
  { title: "Tạo két", lead: "Xem lại rồi ký một giao dịch. Két được tạo trên Avalanche Fuji." },
  { title: "Nạp tiền", lead: "Nạp tiền cho agent tiêu, và phí để agent tự gửi giao dịch." },
  { title: "Kết nối agent", lead: "Đưa khoá API và cấu hình này cho agent. Xong là agent tự chi được." },
] as const;

function Stepper({ current }: { current: number }) {
  return (
    <>
      <div className="flex flex-col gap-2 md:hidden">
        <span className="text-sm text-muted tabular-nums">
          Bước {current + 1}/{STEPS.length}
        </span>
        <ProgressBar aria-label="Tiến độ" value={((current + 1) / STEPS.length) * 100} size="sm">
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      </div>
      <ol aria-label="Các bước" className="hidden items-center gap-2 md:flex">
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={s.title}
              aria-current={active ? "step" : undefined}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : done
                      ? "bg-success-soft text-success-soft-foreground"
                      : "bg-default text-muted"
                }`}
              >
                {done ? <CircleCheckFill aria-hidden="true" className="size-4" /> : i + 1}
              </span>
              <span className={`truncate text-sm ${active ? "font-semibold" : "text-muted"}`}>{s.title}</span>
              {i < STEPS.length - 1 ? (
                <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-separator" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function StepCard({ index, children, footer }: { index: number; children: ReactNode; footer: ReactNode }) {
  const s = STEPS[index];
  return (
    <Card key={index} className="animate-step-in sm:p-6">
      <Card.Header className="gap-2">
        <Card.Title className="text-title">{s?.title}</Card.Title>
        <Card.Description className="text-base">{s?.lead}</Card.Description>
      </Card.Header>
      <Card.Content className="pt-2">{children}</Card.Content>
      <Card.Footer className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
        {footer}
      </Card.Footer>
    </Card>
  );
}

type Created = { vault: Address; agentId?: number; apiKey?: string };

const ROW_STATES = [
  "Ký trong ví",
  "Tạo két trên chain",
  "Lưu vào tài khoản",
  "Cấp khoá API cho agent",
] as const;

export default function SetupPage() {
  const router = useRouter();
  const refreshMe = useRefreshMe();
  const { setVault } = useSelectedVault();
  const owner = useOwnerReady();
  // ?buoc=1..4 opens a step before the vault exists (links from Tổng quan; "Tạo két" still needs a ready wallet).
  const [step, setStep] = useState(() => {
    if (typeof window === "undefined") return 0;
    const n = Number(new URLSearchParams(window.location.search).get("buoc"));
    return Number.isInteger(n) && n >= 1 && n <= 4 ? n - 1 : 0;
  });
  const [draft, setDraft] = useState<SetupDraft>(DEFAULT_DRAFT);
  const [generatedPk, setGeneratedPk] = useState<Hex | null>(null);
  const [savedKey, setSavedKey] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [saving, setSaving] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

  const factory = deployment.factory;

  /** Off-chain bookkeeping after the vault exists; safe to run again (it resumes where it stopped). */
  async function save(c: Created): Promise<Created> {
    setSaving({ busy: true });
    try {
      await accountApi("/api/account/vaults", "POST", { address: c.vault, label: draft.vaultLabel });
      await refreshMe();
      let agentId = c.agentId;
      if (agentId === undefined) {
        const r = await wsApi<{ agent: { id: number } }>(c.vault, "agents", "POST", {
          name: draft.agentName,
          address: draft.agentAddress,
        });
        agentId = r.agent.id;
      }
      for (const r of filledRecipients(draft.recipients)) {
        await wsApi(c.vault, "contacts", "POST", { name: r.name || "Người nhận", address: r.address }).catch(
          () => undefined, // a duplicate in the address book is fine
        );
      }
      let apiKey = c.apiKey;
      if (!apiKey) {
        const k = await wsApi<{ key: string }>(c.vault, `agents/${agentId}/keys`, "POST", {
          name: "Khoá đầu tiên",
        });
        apiKey = k.key;
      }
      const next = { vault: c.vault, agentId, apiKey };
      setCreated(next);
      setVault(c.vault);
      setSaving({ busy: false });
      return next;
    } catch (e) {
      setSaving({ busy: false, error: errorOf(e) });
      setCreated({ ...c });
      throw e;
    }
  }

  async function create() {
    if (!factory) return;
    const receipt = await tx.run(() =>
      writeContractAsync({
        address: factory,
        abi: vaultFactoryAbi,
        functionName: "createVault",
        args: [draft.agentAddress as Address, vaultConfig(draft, deployment.usdc)],
        chainId: avalancheFuji.id,
      }),
    );
    if (!receipt) return;
    const [event] = parseEventLogs({ abi: vaultFactoryAbi, logs: receipt.logs, eventName: "VaultCreated" });
    if (!event) {
      setSaving({ busy: false, error: "Không tìm thấy két mới trong giao dịch." });
      return;
    }
    const c: Created = { vault: event.args.vault };
    setCreated(c);
    try {
      await save(c);
      setStep(4);
    } catch {
      /* the error is shown with a retry */
    }
  }

  const back = (
    <Button variant="ghost" onPress={() => setStep(step - 1)} isDisabled={step === 0}>
      <ArrowLeft aria-hidden="true" />
      Quay lại
    </Button>
  );
  const next = (enabled: boolean, label = "Tiếp tục") => (
    <Button variant="primary" isDisabled={!enabled} onPress={() => setStep(step + 1)}>
      {label}
      <ArrowRight aria-hidden="true" />
    </Button>
  );

  if (NETWORK === "local")
    return (
      <div className="mx-auto w-full max-w-2xl py-10">
        <Notice title="Tạo két cần mạng Fuji">
          Bản này chạy trên fork, nơi không có ví để ký. Mở dashboard ở mạng Fuji (
          <code className="font-mono text-xs">NEXT_PUBLIC_NETWORK=fuji</code>) để tạo két.
        </Notice>
      </div>
    );
  if (!factory)
    return (
      <div className="mx-auto w-full max-w-2xl py-10">
        <ErrorBox
          title="Chưa có VaultFactory trên mạng này"
          detail="Chạy pnpm deploy-factory:fuji rồi tải lại trang."
        />
      </div>
    );

  const creating = tx.busy || saving.busy;
  const rowState = (i: number): "done" | "busy" | "todo" | "bad" => {
    const ph = tx.phase.step;
    if (i === 0)
      return ph === "wallet"
        ? "busy"
        : ph === "failed" && !("hash" in tx.phase && tx.phase.hash)
          ? "bad"
          : ph === "idle"
            ? "todo"
            : "done";
    if (i === 1)
      return ph === "mining"
        ? "busy"
        : ph === "done"
          ? "done"
          : ph === "failed" && "hash" in tx.phase && tx.phase.hash
            ? "bad"
            : "todo";
    if (i === 2)
      return created?.agentId !== undefined
        ? "done"
        : saving.busy
          ? "busy"
          : saving.error && !created?.agentId
            ? "bad"
            : "todo";
    return created?.apiKey
      ? "done"
      : saving.busy && created?.agentId !== undefined
        ? "busy"
        : saving.error && created?.agentId !== undefined
          ? "bad"
          : "todo";
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 py-6">
      <Stepper current={step} />

      {step === 0 ? (
        <StepCard
          index={0}
          footer={
            <>
              <span />
              {next(owner.ready)}
            </>
          }
        >
          <OwnerStep />
        </StepCard>
      ) : null}

      {step === 1 ? (
        <StepCard
          index={1}
          footer={
            <>
              {back}
              {next(agentStepReady(draft, owner.wallets, generatedPk, savedKey))}
            </>
          }
        >
          <AgentStep
            draft={draft}
            setDraft={setDraft}
            generatedPk={generatedPk}
            setGeneratedPk={setGeneratedPk}
            ownerWallets={owner.wallets}
            savedKey={savedKey}
            setSavedKey={setSavedKey}
          />
        </StepCard>
      ) : null}

      {step === 2 ? (
        <StepCard
          index={2}
          footer={
            <>
              {back}
              {next(rulesStepReady(draft))}
            </>
          }
        >
          <RulesStep draft={draft} setDraft={setDraft} />
        </StepCard>
      ) : null}

      {step === 3 ? (
        <StepCard
          index={3}
          footer={
            <>
              {created ? <span /> : back}
              {created && !saving.error ? (
                next(true)
              ) : created && saving.error ? (
                <Button
                  variant="primary"
                  isPending={saving.busy}
                  onPress={() =>
                    void save(created)
                      .then(() => setStep(4))
                      .catch(() => undefined)
                  }
                >
                  Thử lưu lại
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  isPending={creating}
                  isDisabled={!owner.ready}
                  onPress={() => void create()}
                >
                  {tx.phase.step === "failed" ? "Thử lại" : "Tạo két"}
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-6">
            <TextField
              value={draft.vaultLabel}
              onChange={(v) => setDraft({ ...draft, vaultLabel: v })}
              maxLength={40}
              isDisabled={creating || Boolean(created)}
            >
              <Label>Tên két</Label>
              <Input />
            </TextField>
            <ReviewSummary draft={draft} owner={owner.address} />
            {!owner.ready ? (
              <Notice status="warning" title="Ví chủ chưa sẵn sàng">
                Quay lại bước 1: ví cần kết nối, ở mạng Fuji, thuộc tài khoản và có AVAX trả phí.
              </Notice>
            ) : null}
            {tx.phase.step !== "idle" ? (
              <ol
                aria-label="Tiến trình tạo két"
                aria-live="polite"
                className="flex flex-col gap-2 rounded-xl bg-surface-secondary p-4 text-sm"
              >
                {ROW_STATES.map((label, i) => {
                  const s = rowState(i);
                  return (
                    <li key={label} className="flex items-center gap-2">
                      {s === "done" ? (
                        <CircleCheckFill aria-hidden="true" className="size-4 text-success" />
                      ) : s === "busy" ? (
                        <Spinner size="sm" color="current" />
                      ) : (
                        <span
                          aria-hidden="true"
                          className={`size-4 rounded-full border ${s === "bad" ? "border-danger bg-danger-soft" : "border-border"}`}
                        />
                      )}
                      <span className={s === "todo" ? "text-muted" : ""}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {tx.phase.step === "failed" ? <TxStatus phase={tx.phase} done="" /> : null}
            {saving.error ? (
              <ErrorBox
                title="Két đã tạo trên chain, nhưng chưa lưu xong vào tài khoản"
                detail={`${saving.error} Bấm "Thử lưu lại": két và tiền không bị ảnh hưởng.`}
              />
            ) : null}
            {created && !saving.error && created.apiKey ? (
              <Notice status="success" title="Đã tạo két">
                Két {created.vault} đã sẵn sàng. Tiếp theo là nạp tiền.
              </Notice>
            ) : null}
          </div>
        </StepCard>
      ) : null}

      {step === 4 && created ? (
        <StepCard
          index={4}
          footer={
            <>
              <span className="text-sm text-muted">Có thể nạp sau ở trang Tổng quan.</span>
              {next(true)}
            </>
          }
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="flex flex-col gap-3">
              <h3 className="text-heading">Tiền cho agent tiêu</h3>
              <DepositForm vault={created.vault} />
            </section>
            <section className="flex flex-col gap-3">
              <h3 className="text-heading">Phí cho ví agent</h3>
              <p className="text-sm text-muted">
                Agent tự trả phí mạng và phí Guardian từ ví riêng, không lấy từ két.
              </p>
              <AgentFeeForm agent={draft.agentAddress as Address} />
            </section>
          </div>
        </StepCard>
      ) : null}

      {step === 5 && created ? (
        <StepCard
          index={5}
          footer={
            <>
              {back}
              <Button variant="primary" onPress={() => router.push("/")}>
                Xong, mở Tổng quan
                <ArrowRight aria-hidden="true" />
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-6">
            {created.apiKey ? <ApiKeyReveal apiKey={created.apiKey} /> : null}
            <McpSetup apiKey={created.apiKey ?? null} agentPk={generatedPk} />
          </div>
        </StepCard>
      ) : null}
    </div>
  );
}
