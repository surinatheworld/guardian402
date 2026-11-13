"use client";
// Quy tắc chi tiêu: what the agent may spend, to whom and at what risk, read from the vault on chain (the vault is
// the rule book). Each change is reviewed (before → after) and signed in the owner's wallet. The questions are
// the ones /bat-dau asked when the vault was created; per-asset thresholds and apps sit under "Nâng cao".
import { ArrowRotateLeft, Plus, TrashBin } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Checkbox } from "@heroui/react/checkbox";
import { Description } from "@heroui/react/description";
import { Label } from "@heroui/react/label";
import { NumberField } from "@heroui/react/number-field";
import { Radio } from "@heroui/react/radio";
import { RadioGroup } from "@heroui/react/radio-group";
import { Table } from "@heroui/react/table";
import { Meter } from "@heroui/react/meter";
import { useState, type ReactNode } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi } from "@guardian402/shared";
import { EditModal } from "@/components/edit-modal";
import { TextInput } from "@/components/fields";
import { useOwnerAction } from "@/components/owner-action";
import { AddressLink, Card, Empty, ErrorBox, Expand, LoadingRows, Notice } from "@/components/ui";
import { OwnerGateNotice, useOwnerGate, type OwnerGate } from "@/components/wallet";
import { accountApi, AccountApiError, useMe } from "@/lib/account";
import { deployment, knownName, tokenMeta } from "@/lib/config";
import { formatAmount, fromUnits, shortHex, toUnits } from "@/lib/format";
import { MAX_RISK_LABEL, PAGE, RISK_BY_CODE } from "@/lib/labels";
import { looksLike } from "@/lib/lookalike";
import { useVaultLimits, useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";
import { useContacts, useInvalidate, wsPath } from "@/lib/workspace";

type Policy = NonNullable<ReturnType<typeof useVaultPolicy>["data"]>;
type Owner = ReturnType<typeof useOwnerAction>;

export default function RulesPage() {
  const { address: vault, viewingDemo } = useSelectedVault();
  const policy = useVaultPolicy();
  const limits = useVaultLimits();
  const p = policy.data;
  const gate = useOwnerGate(p?.owner);
  const owner = useOwnerAction();
  const me = useMe();
  const linked =
    !viewingDemo && Boolean(me.data?.vaults.some((v) => v.address.toLowerCase() === vault.toLowerCase()));

  return (
    <>
      <header className="flex flex-col gap-1 pt-4">
        <h1 className="text-title">{PAGE.rules}</h1>
        <p className="text-base text-muted">
          Chọn người nhận, hạn mức và mức rủi ro agent được phép sử dụng.
        </p>
      </header>
      {viewingDemo ? null : <OwnerGateNotice gate={gate} />}
      {policy.isPending ? <LoadingRows rows={4} label="Đang đọc két trên chain" /> : null}
      {policy.isError ? (
        <ErrorBox
          title="Không đọc được két trên chain"
          detail={policy.error.message.split("\n")[0]}
          onRetry={() => void policy.refetch()}
        />
      ) : null}
      {p ? (
        <>
          <Recipients p={p} vault={vault} gate={gate} owner={owner} linked={linked} />
          <SpendLimits
            p={p}
            vault={vault}
            gate={gate}
            owner={owner}
            limits={limits.data}
            unsupported={limits.unsupported}
          />
          <MaxRisk p={p} vault={vault} gate={gate} owner={owner} />
          <Expand label="Nâng cao: ngưỡng duyệt, quyền rút cho ứng dụng, AVAX">
            <div className="flex flex-col gap-4">
              <Limits p={p} vault={vault} gate={gate} owner={owner} />
              <Apps p={p} vault={vault} gate={gate} owner={owner} />
            </div>
          </Expand>
        </>
      ) : null}
      {owner.dialog}
    </>
  );
}

type SectionProps = { p: Policy; vault: Address; gate: OwnerGate; owner: Owner };

// ------------------------------------------------------------------ how much (USDC)

type LimitsData = ReturnType<typeof useVaultLimits>["data"];

function Tile({
  label,
  value,
  sub,
  action,
  meter,
}: {
  label: string;
  value: string;
  sub?: string;
  action?: ReactNode;
  meter?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-secondary p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-muted">{label}</span>
        {action}
      </div>
      <span className="text-heading tabular-nums">{value}</span>
      {meter !== undefined ? (
        <Meter
          aria-label={`${label}: đã dùng`}
          value={meter}
          size="sm"
          color={meter >= 90 ? "danger" : "accent"}
        >
          <Meter.Track>
            <Meter.Fill />
          </Meter.Track>
        </Meter>
      ) : null}
      {sub ? <span className="text-sm text-muted tabular-nums">{sub}</span> : null}
    </div>
  );
}

function SpendLimits({
  p,
  vault,
  gate,
  owner,
  limits,
  unsupported,
}: SectionProps & { limits: LimitsData; unsupported: boolean }) {
  const { writeContractAsync } = useWriteContract();
  const t = p.tokens.find((x) => x.token.toLowerCase() === deployment.usdc.toLowerCase());
  const l = limits?.find((x) => x.token.toLowerCase() === deployment.usdc.toLowerCase());
  const [editDaily, setEditDaily] = useState(false);
  const [editLimits, setEditLimits] = useState(false);
  const [daily, setDaily] = useState(0);
  const [perTx, setPerTx] = useState(0);
  const [budget, setBudget] = useState(0);
  const u = (v: bigint) => `${formatAmount(v, 6, 2)} USDC`;
  const pct = (a: bigint, b: bigint) => (b > 0n ? Number(((a > b ? b : a) * 1000n) / b) / 10 : 0);
  if (!t)
    return (
      <Card title="Agent được tiêu bao nhiêu?">
        <Empty>Két chưa cho agent tiêu USDC.</Empty>
      </Card>
    );
  const edit = (onPress: () => void, label: string) =>
    gate.ok ? (
      <Button size="sm" variant="ghost" className="-mt-1 -mr-2" aria-label={label} onPress={onPress}>
        Sửa
      </Button>
    ) : null;
  const left = l && l.budget > l.spentSinceReset ? l.budget - l.spentSinceReset : 0n;
  return (
    <Card
      title="Agent được tiêu bao nhiêu?"
      description="Tính bằng USDC. Vượt bất kỳ mức nào, két từ chối cả giao dịch."
    >
      <div id="han-muc" className="grid scroll-mt-24 gap-3 md:grid-cols-3">
        <Tile
          label="Mỗi ngày"
          value={u(t.dailyCap)}
          meter={pct(t.spentToday, t.dailyCap)}
          sub={`Hôm nay đã tiêu ${u(t.spentToday)} · làm mới lúc 07:00`}
          action={edit(() => {
            setDaily(fromUnits(t.dailyCap, 6));
            setEditDaily(true);
          }, "Sửa hạn mức mỗi ngày")}
        />
        {unsupported ? (
          <div className="flex flex-col justify-center rounded-2xl bg-surface-secondary p-4 text-sm text-muted md:col-span-2">
            Két này tạo trước khi có hạn mức mỗi giao dịch và tổng ngân sách. Tạo két mới để dùng hai mức này.
          </div>
        ) : (
          <>
            <Tile
              label="Mỗi giao dịch"
              value={l && l.maxPerTx > 0n ? u(l.maxPerTx) : "Không giới hạn"}
              action={edit(() => {
                setPerTx(fromUnits(l?.maxPerTx ?? 0n, 6));
                setBudget(fromUnits(l?.budget ?? 0n, 6));
                setEditLimits(true);
              }, "Sửa hạn mức mỗi giao dịch và tổng")}
            />
            <Tile
              label="Tổng cộng"
              value={l && l.budget > 0n ? u(l.budget) : "Không giới hạn"}
              {...(l && l.budget > 0n ? { meter: pct(l.spentSinceReset, l.budget) } : {})}
              sub={
                l && l.budget > 0n
                  ? left === 0n
                    ? "Đã dùng hết: agent đang dừng chi."
                    : `Còn ${u(left)} · đã dùng ${u(l.spentSinceReset)}`
                  : "Chỉ giới hạn theo ngày."
              }
              action={
                gate.ok && l && l.budget > 0n && l.spentSinceReset > 0n ? (
                  <Button
                    size="sm"
                    variant={left === 0n ? "primary" : "ghost"}
                    className="-mt-1 -mr-2"
                    onPress={() =>
                      owner.request({
                        title: "Làm mới tổng ngân sách",
                        summary: `Agent được tiêu lại tối đa ${u(l.budget)} tính từ bây giờ.`,
                        changes: [{ label: "Đã dùng", before: u(l.spentSinceReset), after: "0 USDC" }],
                        call: `AgentVault.resetBudget(${deployment.usdc})`,
                        confirmLabel: "Ký và làm mới",
                        successTitle: "Đã làm mới tổng ngân sách",
                        send: () =>
                          writeContractAsync({
                            address: vault,
                            abi: agentVaultAbi,
                            functionName: "resetBudget",
                            args: [deployment.usdc],
                            chainId: avalancheFuji.id,
                          }),
                      })
                    }
                  >
                    <ArrowRotateLeft aria-hidden="true" />
                    Làm mới
                  </Button>
                ) : null
              }
            />
          </>
        )}
      </div>
      <EditModal
        isOpen={editDaily}
        onOpenChange={setEditDaily}
        title="Hạn mức mỗi ngày"
        isSubmitDisabled={daily <= 0}
        onSubmit={() => {
          setEditDaily(false);
          const next = toUnits(daily, 6);
          if (next === t.dailyCap) return;
          owner.request({
            title: "Đổi hạn mức mỗi ngày",
            summary: `Agent được tiêu tối đa ${u(next)} mỗi ngày.`,
            changes: [{ label: "Mỗi ngày", before: u(t.dailyCap), after: u(next) }],
            call: `AgentVault.setTokenPolicy(USDC, true, ${next}, ${t.maxApproval}, ${t.verdictThreshold})`,
            confirmLabel: "Ký và áp dụng",
            successTitle: "Đã đổi hạn mức mỗi ngày",
            send: () =>
              writeContractAsync({
                address: vault,
                abi: agentVaultAbi,
                functionName: "setTokenPolicy",
                args: [t.token, true, next, t.maxApproval, t.verdictThreshold],
                chainId: avalancheFuji.id,
              }),
          });
        }}
      >
        <AmountField label="Tiêu tối đa mỗi ngày" unit="USDC" value={daily} onChange={setDaily} />
      </EditModal>
      <EditModal
        isOpen={editLimits}
        onOpenChange={setEditLimits}
        title="Mỗi giao dịch và tổng cộng"
        onSubmit={() => {
          setEditLimits(false);
          const nextTx = toUnits(perTx, 6);
          const nextBudget = toUnits(budget, 6);
          owner.request({
            title: "Đổi hạn mức mỗi giao dịch và tổng",
            summary: "Lưu ý: đặt lại tổng ngân sách sẽ đếm lại từ 0 kể từ lúc ký.",
            changes: [
              {
                label: "Mỗi giao dịch",
                before: l && l.maxPerTx > 0n ? u(l.maxPerTx) : "Không giới hạn",
                after: nextTx > 0n ? u(nextTx) : "Không giới hạn",
              },
              {
                label: "Tổng cộng",
                before: l && l.budget > 0n ? u(l.budget) : "Không giới hạn",
                after: nextBudget > 0n ? u(nextBudget) : "Không giới hạn",
              },
            ],
            call: `AgentVault.setLimits(${deployment.usdc}, ${nextTx}, ${nextBudget})`,
            confirmLabel: "Ký và áp dụng",
            successTitle: "Đã đổi hạn mức",
            send: () =>
              writeContractAsync({
                address: vault,
                abi: agentVaultAbi,
                functionName: "setLimits",
                args: [deployment.usdc, nextTx, nextBudget],
                chainId: avalancheFuji.id,
              }),
          });
        }}
      >
        <AmountField
          label="Mỗi giao dịch"
          unit="USDC"
          value={perTx}
          onChange={setPerTx}
          description="0 = không giới hạn."
        />
        <AmountField
          label="Tổng cộng"
          unit="USDC"
          value={budget}
          onChange={setBudget}
          description="0 = không giới hạn. Hết thì agent dừng tới khi bạn làm mới."
        />
      </EditModal>
    </Card>
  );
}

// ------------------------------------------------------------------ daily limits

type LimitRow = {
  key: string;
  symbol: string;
  decimals: number;
  dailyCap: bigint;
  spentToday: bigint;
  threshold: bigint;
  maxApproval: bigint | null;
  token: Address | null;
};

function Limits({ p, vault, gate, owner }: SectionProps) {
  const { writeContractAsync } = useWriteContract();
  const [edit, setEdit] = useState<LimitRow | null>(null);
  const [cap, setCap] = useState(0);
  const [threshold, setThreshold] = useState(0);
  const [approval, setApproval] = useState(0);
  const rows: LimitRow[] = [
    ...p.tokens.map((t) => {
      const m = tokenMeta(t.token);
      return {
        key: t.token,
        symbol: m.symbol,
        decimals: m.decimals,
        dailyCap: t.dailyCap,
        spentToday: t.spentToday,
        threshold: t.verdictThreshold,
        maxApproval: t.maxApproval,
        token: t.token,
      };
    }),
    {
      key: "native",
      symbol: "AVAX",
      decimals: 18,
      dailyCap: p.nativeDailyCap,
      spentToday: p.nativeSpentToday,
      threshold: p.nativeVerdictThreshold,
      maxApproval: null,
      token: null,
    },
  ];
  const fmt = (r: LimitRow, v: bigint) => `${formatAmount(v, r.decimals, 6)} ${r.symbol}`;

  const review = () => {
    if (!edit) return;
    const r = edit;
    const next = {
      cap: toUnits(cap, r.decimals),
      threshold: toUnits(threshold, r.decimals),
      approval: r.maxApproval === null ? null : toUnits(approval, r.decimals),
    };
    const changes = [
      ...(next.cap !== r.dailyCap
        ? [{ label: "Tiêu tối đa mỗi ngày", before: fmt(r, r.dailyCap), after: fmt(r, next.cap) }]
        : []),
      ...(next.threshold !== r.threshold
        ? [{ label: "Cần Guardian duyệt từ", before: fmt(r, r.threshold), after: fmt(r, next.threshold) }]
        : []),
      ...(r.maxApproval !== null && next.approval !== null && next.approval !== r.maxApproval
        ? [{ label: "Quyền rút tối đa", before: fmt(r, r.maxApproval), after: fmt(r, next.approval) }]
        : []),
    ];
    setEdit(null);
    if (!changes.length) return;
    owner.request({
      title: `Đổi hạn mức ${r.symbol}`,
      summary: (
        <>
          Agent được tiêu tối đa <strong className="font-semibold">{fmt(r, next.cap)}</strong> mỗi ngày; từ{" "}
          {fmt(r, next.threshold)} trở lên cần Guardian duyệt.
        </>
      ),
      changes,
      call:
        r.token === null
          ? `AgentVault.setNativePolicy(${next.cap}, ${next.threshold})`
          : `AgentVault.setTokenPolicy(${r.symbol}, true, ${next.cap}, ${next.approval}, ${next.threshold})`,
      confirmLabel: "Ký và áp dụng",
      successTitle: `Đã cập nhật hạn mức ${r.symbol}`,
      send: () =>
        r.token === null
          ? writeContractAsync({
              address: vault,
              abi: agentVaultAbi,
              functionName: "setNativePolicy",
              args: [next.cap, next.threshold],
              chainId: avalancheFuji.id,
            })
          : writeContractAsync({
              address: vault,
              abi: agentVaultAbi,
              functionName: "setTokenPolicy",
              args: [r.token, true, next.cap, next.approval ?? 0n, next.threshold],
              chainId: avalancheFuji.id,
            }),
    });
  };

  return (
    <Card
      title="Theo từng tài sản"
      description="Hạn mức ngày, ngưỡng cần Guardian duyệt và quyền rút cho ứng dụng."
    >
      <Table id="han-muc">
        <Table.ScrollContainer>
          <Table.Content aria-label="Hạn mức chi tiêu theo tài sản" className="min-w-[36rem] tabular-nums">
            <Table.Header>
              <Table.Column isRowHeader>Tài sản</Table.Column>
              <Table.Column>Tiêu tối đa mỗi ngày</Table.Column>
              <Table.Column>Đã tiêu hôm nay</Table.Column>
              <Table.Column>Cần Guardian duyệt từ</Table.Column>
              <Table.Column>Quyền rút tối đa</Table.Column>
              <Table.Column>
                <span className="sr-only">Thao tác</span>
              </Table.Column>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.key} id={r.key}>
                  <Table.Cell className="font-medium">{r.symbol}</Table.Cell>
                  <Table.Cell className="font-medium">{fmt(r, r.dailyCap)}</Table.Cell>
                  <Table.Cell className="text-muted">{fmt(r, r.spentToday)}</Table.Cell>
                  <Table.Cell>{fmt(r, r.threshold)}</Table.Cell>
                  <Table.Cell>{r.maxApproval === null ? "—" : fmt(r, r.maxApproval)}</Table.Cell>
                  <Table.Cell className="text-right">
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={!gate.ok}
                      aria-label={`Sửa hạn mức ${r.symbol}`}
                      onPress={() => {
                        setCap(fromUnits(r.dailyCap, r.decimals));
                        setThreshold(fromUnits(r.threshold, r.decimals));
                        setApproval(r.maxApproval === null ? 0 : fromUnits(r.maxApproval, r.decimals));
                        setEdit(r);
                      }}
                    >
                      Sửa
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <EditModal
        isOpen={edit !== null}
        onOpenChange={(o) => !o && setEdit(null)}
        title={`Hạn mức ${edit?.symbol ?? ""}`}
        onSubmit={review}
      >
        <AmountField label="Tiêu tối đa mỗi ngày" unit={edit?.symbol ?? ""} value={cap} onChange={setCap} />
        <AmountField
          label="Cần Guardian duyệt từ"
          unit={edit?.symbol ?? ""}
          value={threshold}
          onChange={setThreshold}
          description="Đặt bằng 0 để mọi giao dịch đều cần Guardian duyệt."
        />
        {edit?.maxApproval !== null ? (
          <AmountField
            label="Quyền rút tối đa cho ứng dụng"
            unit={edit?.symbol ?? ""}
            value={approval}
            onChange={setApproval}
            description="Số tối đa một ứng dụng (ví dụ sàn swap) được tự rút từ két sau khi agent cấp quyền."
          />
        ) : null}
      </EditModal>
    </Card>
  );
}

function AmountField({
  label,
  unit,
  value,
  onChange,
  description,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  description?: string;
}) {
  return (
    <NumberField
      variant="secondary"
      value={value}
      onChange={onChange}
      minValue={0}
      step={1}
      formatOptions={{ maximumFractionDigits: 6 }}
    >
      <Label>
        {label} ({unit})
      </Label>
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input className="tabular-nums" />
        <NumberField.IncrementButton />
      </NumberField.Group>
      {description ? <Description>{description}</Description> : null}
    </NumberField>
  );
}

// ------------------------------------------------------------------ max risk

function MaxRisk({ p, vault, gate, owner }: SectionProps) {
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(p.maxAgentRisk));
  const current = RISK_BY_CODE[p.maxAgentRisk] ?? "LOW";
  return (
    <Card
      title="Guardian được duyệt tới mức rủi ro nào?"
      description="Két từ chối khoản chi rủi ro cao hơn, kể cả khi Guardian đã ký."
      actions={
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={!gate.ok}
          onPress={() => {
            setValue(String(p.maxAgentRisk));
            setOpen(true);
          }}
        >
          Sửa
        </Button>
      }
    >
      <p className="text-base font-medium">{MAX_RISK_LABEL[current]}</p>
      <EditModal
        isOpen={open}
        onOpenChange={setOpen}
        title="Mức rủi ro tối đa"
        onSubmit={() => {
          setOpen(false);
          const next = Number(value);
          if (next === p.maxAgentRisk) return;
          const label = MAX_RISK_LABEL[RISK_BY_CODE[next] ?? "LOW"];
          owner.request({
            title: "Đổi mức rủi ro tối đa",
            summary: `${label}. Giao dịch có rủi ro cao hơn sẽ bị két từ chối, kể cả khi Guardian đã ký.`,
            changes: [{ label: "Mức tối đa", before: MAX_RISK_LABEL[current], after: label }],
            call: `AgentVault.setMaxAgentRisk(${next})`,
            confirmLabel: "Ký và áp dụng",
            successTitle: "Đã đổi mức rủi ro tối đa",
            danger: next === 2,
            send: () =>
              writeContractAsync({
                address: vault,
                abi: agentVaultAbi,
                functionName: "setMaxAgentRisk",
                args: [next],
                chainId: avalancheFuji.id,
              }),
          });
        }}
      >
        <RadioGroup value={value} onChange={setValue} aria-label="Mức rủi ro tối đa">
          {(["0", "1", "2"] as const).map((v) => (
            <Radio key={v} value={v}>
              <Radio.Content>
                <Radio.Control>
                  <Radio.Indicator />
                </Radio.Control>
                {MAX_RISK_LABEL[RISK_BY_CODE[Number(v)] ?? "LOW"]}
              </Radio.Content>
              <Description>
                {v === "0"
                  ? "Khuyên dùng."
                  : v === "1"
                    ? "Cho qua cả cảnh báo vừa."
                    : "Không khuyên dùng: két tin mọi phê duyệt."}
              </Description>
            </Radio>
          ))}
        </RadioGroup>
      </EditModal>
    </Card>
  );
}

// ------------------------------------------------------------------ trusted recipients

function Recipients({ p, vault, gate, owner, linked }: SectionProps & { linked: boolean }) {
  const { writeContractAsync } = useWriteContract();
  const contacts = useContacts(vault, linked).data?.contacts ?? [];
  const invalidate = useInvalidate(vault);
  const nameOf = (a: string) =>
    contacts.find((c) => c.address.toLowerCase() === a.toLowerCase())?.name ?? knownName(a);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trusted = [
    ...p.recipients.map((a) => ({ name: nameOf(a) ?? shortHex(a), address: a })),
    ...contacts.map((c) => ({ name: c.name, address: c.address })),
    { name: "Sàn swap thử nghiệm", address: deployment.router },
    { name: "chủ két", address: p.owner },
    { name: "két", address: vault },
  ];
  const valid = isAddress(address.trim());
  const mimic = valid ? trusted.find((t) => looksLike(address.trim(), t.address)) : undefined;
  const already = valid && p.recipients.some((r) => r.toLowerCase() === address.trim().toLowerCase());

  const remove = (a: Address) =>
    owner.request({
      title: "Gỡ người nhận tin cậy",
      summary: (
        <>
          Agent không chuyển tiền tới <AddressLink address={a} name={nameOf(a)} /> được nữa.
        </>
      ),
      call: `AgentVault.setAllowedRecipient(${a}, false)`,
      confirmLabel: "Ký và gỡ",
      successTitle: "Đã gỡ người nhận",
      danger: true,
      send: () =>
        writeContractAsync({
          address: vault,
          abi: agentVaultAbi,
          functionName: "setAllowedRecipient",
          args: [a, false],
          chainId: avalancheFuji.id,
        }),
    });

  const add = async () => {
    const a = getAddress(address.trim());
    if (linked && name.trim()) {
      try {
        await accountApi(wsPath(vault, "contacts"), "POST", {
          name: name.trim(),
          address: a,
          kind: "recipient",
          note: "",
          confirmLookalike: confirmed,
        });
        void invalidate("contacts");
      } catch (e) {
        if (!(e instanceof AccountApiError && e.code === "duplicate")) {
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
      }
    }
    setOpen(false);
    owner.request({
      title: "Thêm người nhận tin cậy",
      summary: (
        <>
          Agent được chuyển tiền tới <AddressLink address={a} name={name.trim() || undefined} />, vẫn trong
          hạn mức mỗi ngày.
        </>
      ),
      call: `AgentVault.setAllowedRecipient(${a}, true)`,
      confirmLabel: "Ký và thêm",
      successTitle: "Đã thêm người nhận tin cậy",
      send: () =>
        writeContractAsync({
          address: vault,
          abi: agentVaultAbi,
          functionName: "setAllowedRecipient",
          args: [a, true],
          chainId: avalancheFuji.id,
        }),
    });
  };

  return (
    <Card
      title="Agent được trả tiền cho ai?"
      description="Địa chỉ ngoài danh sách này luôn bị két từ chối."
      actions={
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={!gate.ok}
          onPress={() => {
            setName("");
            setAddress("");
            setConfirmed(false);
            setError(null);
            setOpen(true);
          }}
        >
          <Plus aria-hidden="true" />
          Thêm người nhận
        </Button>
      }
    >
      <div id="nguoi-nhan" className="scroll-mt-24">
        {p.recipients.length === 0 ? (
          <Empty>Chưa có người nhận nào. Agent chưa chuyển tiền được cho ai.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-separator">
            {p.recipients.map((a) => (
              <li key={a} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <AddressLink address={a} name={nameOf(a)} />
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  isDisabled={!gate.ok}
                  aria-label={`Gỡ ${nameOf(a) ?? a}`}
                  onPress={() => remove(a)}
                >
                  <TrashBin aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <EditModal
        isOpen={open}
        onOpenChange={setOpen}
        title="Thêm người nhận tin cậy"
        isSubmitDisabled={!valid || already || (Boolean(mimic) && !confirmed)}
        onSubmit={() => void add()}
      >
        {linked ? (
          <TextInput
            label="Tên (để bạn nhận ra)"
            value={name}
            onChange={setName}
            maxLength={60}
            placeholder="Ví dụ: Nhà cung cấp A"
          />
        ) : null}
        <TextInput
          label="Địa chỉ ví"
          value={address}
          onChange={(v) => {
            setAddress(v);
            setConfirmed(false);
            setError(null);
          }}
          mono
          isRequired
          placeholder="0x…"
          error={
            address.trim() && !valid
              ? "Địa chỉ phải có dạng 0x và 40 ký tự hex."
              : already
                ? "Địa chỉ này đã là người nhận tin cậy."
                : error
          }
        />
        {mimic ? (
          <>
            <Notice status="danger" title="Có thể là địa chỉ nhái">
              Địa chỉ này giống {mimic.name} ({shortHex(mimic.address)}) ở 3 ký tự đầu và 3 ký tự cuối nhưng
              khác ở giữa. Kẻ gian thường tạo địa chỉ như vậy để bạn chép nhầm.
            </Notice>
            <Checkbox isSelected={confirmed} onChange={setConfirmed}>
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>Tôi đã so từng ký tự với nguồn tin cậy</Label>
              </Checkbox.Content>
            </Checkbox>
          </>
        ) : null}
      </EditModal>
    </Card>
  );
}

// ------------------------------------------------------------------ apps (contracts)

function Apps({ p, vault, gate, owner }: SectionProps) {
  const { writeContractAsync } = useWriteContract();
  return (
    <Card title="Ứng dụng được dùng" description="Hợp đồng agent được gọi, ví dụ sàn swap">
      <div id="ung-dung" className="scroll-mt-24">
        {p.targets.length === 0 ? (
          <Empty>Chưa có ứng dụng nào. Agent chỉ chuyển tiền trực tiếp được.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-separator">
            {p.targets.map((t) => (
              <li
                key={t.target}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <AddressLink address={t.target} />
                  <span className="text-xs text-muted">{t.selectors.length} thao tác được phép</span>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  isDisabled={!gate.ok}
                  aria-label={`Gỡ ${knownName(t.target) ?? t.target}`}
                  onPress={() =>
                    owner.request({
                      title: "Gỡ ứng dụng",
                      summary: (
                        <>
                          Agent không gọi được <AddressLink address={t.target} /> nữa.
                        </>
                      ),
                      call: `AgentVault.setAllowedTarget(${t.target}, false)`,
                      confirmLabel: "Ký và gỡ",
                      successTitle: "Đã gỡ ứng dụng",
                      danger: true,
                      send: () =>
                        writeContractAsync({
                          address: vault,
                          abi: agentVaultAbi,
                          functionName: "setAllowedTarget",
                          args: [t.target, false],
                          chainId: avalancheFuji.id,
                        }),
                    })
                  }
                >
                  <TrashBin aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted">Thêm ứng dụng mới bằng một bộ quy tắc ở bên dưới.</p>
    </Card>
  );
}
