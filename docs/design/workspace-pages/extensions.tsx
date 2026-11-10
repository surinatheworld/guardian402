import React, { useState } from "react";
import { Card } from "@heroui/react/card";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Modal } from "@heroui/react/modal";
import { Input } from "@heroui/react/input";
import { Tabs } from "@heroui/react/tabs";
import { Table } from "@heroui/react/table";

const address = (letter: string) => "0x" + letter.repeat(40);
const short = (value: string) => value.slice(0, 8) + "…" + value.slice(-6);
type Portal = { portal?: HTMLElement };
type Row = { id: string; [key: string]: any };
type Column = { id: string; label: string; render: (row: Row) => React.ReactNode };
const Tag = ({
  children,
  color = "default",
  emphasis = false,
}: {
  children: React.ReactNode;
  color?: "default" | "success" | "danger" | "warning" | "info";
  emphasis?: boolean;
}) => (
  <Chip
    className="wx-tag"
    data-tone={color}
    data-emphasis={emphasis || undefined}
    size="sm"
    variant="soft"
    color={color === "info" ? "default" : color}
  >
    <span className="wx-tag-dot" aria-hidden="true" />
    <Chip.Label>{children}</Chip.Label>
  </Chip>
);

function ResourceTable({ rows, columns, label }: { rows: Row[]; columns: Column[]; label: string }) {
  return (
    <Table variant="secondary" className="h3-table wx-resource-table">
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            {columns.map((col, i) => (
              <Table.Column key={col.id} id={col.id} isRowHeader={i === 0}>
                {col.label}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body
            items={rows}
            renderEmptyState={() => (
              <div className="wx-empty">Chưa có dữ liệu. Thêm mục đầu tiên để bắt đầu.</div>
            )}
          >
            {(row) => (
              <Table.Row id={row.id}>
                {columns.map((col) => (
                  <Table.Cell key={col.id} data-column={col.id} data-label={col.label}>
                    {col.render(row)}
                  </Table.Cell>
                ))}
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
function Dialog({
  portal,
  open,
  close,
  title,
  children,
}: {
  portal?: HTMLElement;
  open: boolean;
  close: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
      UNSTABLE_portalContainer={portal}
      className="h3-backdrop"
    >
      <Modal.Container size="md" placement="center">
        <Modal.Dialog className="h3-modal" aria-label={title}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <div className="h3-modal-eyebrow">GUARDIAN WORKSPACE · CONCEPT</div>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
type Field = {
  key: string;
  label: string;
  value: string;
  type?: string;
  readonly?: boolean;
  options?: [string, string][];
};
function Editor({
  portal,
  title,
  fields,
  close,
  save,
  note,
}: {
  portal?: HTMLElement;
  title: string;
  fields: Field[];
  close: () => void;
  save: (values: Record<string, string>) => string | void;
  note: string;
}) {
  const [values, setValues] = useState(Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [error, setError] = useState("");
  return (
    <Dialog portal={portal} open close={close} title={title}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const result = save(values);
          if (result) setError(result);
          else close();
        }}
      >
        <div className="wx-form">
          {fields.map((field) => (
            <label key={field.key} className="wx-field">
              <span>{field.label}</span>
              {field.options ? (
                <select
                  value={values[field.key]}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  disabled={field.readonly}
                >
                  {field.options.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  type={field.type || "text"}
                  value={values[field.key]}
                  isReadOnly={field.readonly}
                  isRequired={["name", "address", "kind", "threshold"].includes(field.key)}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
        <p className="wx-note">{note}</p>
        {error && (
          <p className="wx-error" role="alert">
            {error}
          </p>
        )}
        <div className="wx-form-actions">
          <Button variant="secondary" onPress={close}>
            Huỷ
          </Button>
          <Button type="submit">Lưu trong concept</Button>
        </div>
      </form>
    </Dialog>
  );
}
function Confirm({
  portal,
  title,
  note,
  close,
  confirm,
}: {
  portal?: HTMLElement;
  title: string;
  note: string;
  close: () => void;
  confirm: () => void;
}) {
  return (
    <Dialog portal={portal} open close={close} title={title}>
      <p className="h3-review-summary">{note}</p>
      <div className="wx-form-actions">
        <Button variant="secondary" onPress={close}>
          Huỷ
        </Button>
        <Button
          variant="danger"
          onPress={() => {
            confirm();
            close();
          }}
        >
          Xoá trong concept
        </Button>
      </div>
    </Dialog>
  );
}

export function Agents({ portal, policy }: { portal?: HTMLElement; policy: () => void }) {
  const [rows, setRows] = useState<Row[]>([
    {
      id: "a1",
      name: "Treasury Payments",
      description: "Thanh toán đối tác định kỳ",
      address: address("a"),
      strategy: "payments",
      status: "active",
      authorized: true,
    },
    {
      id: "a2",
      name: "DCA Assistant",
      description: "Mua định kỳ theo ngân sách",
      address: address("b"),
      strategy: "dca",
      status: "paused",
      authorized: false,
    },
    {
      id: "a3",
      name: "Research Agent",
      description: "Đăng ký để theo dõi",
      address: address("c"),
      strategy: "custom",
      status: "active",
      authorized: false,
    },
  ]);
  const [edit, setEdit] = useState<Row | null | false>(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const columns: Column[] = [
    {
      id: "name",
      label: "Agent",
      render: (r) => (
        <div className="wx-agent-identity">
          <div className="h3-tx-name">{r.name}</div>
          <div className="h3-tx-target">{r.description}</div>
        </div>
      ),
    },
    {
      id: "address",
      label: "Ví agent",
      render: (r) => (
        <button
          className="wx-address-button"
          onClick={() => setEdit(r)}
          aria-label={"Xem đầy đủ địa chỉ " + r.name}
        >
          <code>{short(r.address)}</code>
        </button>
      ),
    },
    {
      id: "status",
      label: "Quyền thực thi",
      render: (r) => (
        <div className="wx-agent-status">
          <Tag color={r.authorized ? "success" : "info"} emphasis={r.authorized}>
            {r.authorized ? "Được uỷ quyền" : "Chỉ registry"}
          </Tag>
          <span className="wx-small">
            {r.strategy === "payments" ? "Payments" : r.strategy === "dca" ? "DCA" : "Custom"} ·{" "}
            {r.status === "paused"
              ? "Metadata: paused"
              : r.status === "retired"
                ? "Metadata: retired"
                : "Metadata: active"}
          </span>
        </div>
      ),
    },
    {
      id: "actions",
      label: "",
      render: (r) => (
        <div className="wx-row-actions">
          <Button size="sm" variant="secondary" onPress={() => setEdit(r)}>
            Sửa
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={r.authorized}
            aria-label={"Xoá " + r.name}
            onPress={() => setDeleting(r)}
          >
            Xoá
          </Button>
        </div>
      ),
    },
  ];
  return (
    <>
      <Card className="h3-panel wx-resource">
        <Card.Header>
          <div className="h3-card-heading">
            <div>
              <Card.Title>Agents trong vault</Card.Title>
              <Card.Description>
                {rows.length} agent trong registry · một địa chỉ được uỷ quyền on-chain
              </Card.Description>
            </div>
            <Button onPress={() => setEdit(null)}>+ Thêm agent</Button>
          </div>
        </Card.Header>
        <Card.Content>
          <ResourceTable rows={rows} columns={columns} label="Agent registry" />
        </Card.Content>
        <Card.Footer className="wx-panel-foot">
          <span>Trạng thái registry không thay đổi quyền thực thi.</span>
          <Button variant="ghost" size="sm" onPress={policy}>
            Quản lý quyền →
          </Button>
        </Card.Footer>
      </Card>
      <div className="wx-context-line">
        <span className="wx-context-dot" />
        <span>Agent đang được uỷ quyền chỉ có thể xoá sau khi thu hồi quyền on-chain.</span>
      </div>
      {edit !== false && (
        <Editor
          key={edit?.id || "new"}
          portal={portal}
          title={edit ? "Chỉnh sửa agent" : "Thêm agent"}
          close={() => setEdit(false)}
          note={
            edit
              ? "Địa chỉ agent là bất biến. Chỉnh metadata không tác động on-chain."
              : "Chỉ thêm vào registry. Cấp quyền thực thi là một thay đổi policy riêng."
          }
          fields={[
            { key: "name", label: "Tên agent", value: edit?.name || "" },
            { key: "address", label: "Địa chỉ ví agent", value: edit?.address || "", readonly: !!edit },
            { key: "description", label: "Mô tả", value: edit?.description || "" },
            {
              key: "strategy",
              label: "Chiến lược",
              value: edit?.strategy || "payments",
              options: [
                ["payments", "Payments"],
                ["dca", "DCA"],
                ["custom", "Custom"],
              ],
            },
            ...(edit
              ? [
                  {
                    key: "status",
                    label: "Trạng thái registry",
                    value: edit.status,
                    options: [
                      ["active", "Active"],
                      ["paused", "Paused"],
                      ["retired", "Retired"],
                    ] as [string, string][],
                  },
                ]
              : []),
          ]}
          save={(values) => {
            if (!values.name.trim()) return "Nhập tên agent.";
            if (!/^0x[0-9a-fA-F]{40}$/.test(values.address) || /^0x0{40}$/.test(values.address))
              return "Nhập địa chỉ ví hợp lệ, khác địa chỉ zero.";
            if (
              [address("f"), "0x3f6a5852788ff6a46d924C407976bB89487f7651"].some(
                (a) => a.toLowerCase() === values.address.toLowerCase(),
              )
            )
              return "Dùng ví agent riêng, khác ví chủ và vault.";
            if (
              rows.some((r) => r.id !== edit?.id && r.address.toLowerCase() === values.address.toLowerCase())
            )
              return "Agent này đã có trong registry.";
            if (edit) setRows(rows.map((r) => (r.id === edit.id ? { ...r, ...values } : r)));
            else
              setRows([...rows, { ...values, id: crypto.randomUUID(), status: "active", authorized: false }]);
          }}
        />
      )}
      {deleting && (
        <Confirm
          portal={portal}
          title={"Xoá " + deleting.name + "?"}
          note="Chỉ xoá metadata khỏi registry trong concept. Không thu hồi quyền hay thay đổi tài sản."
          close={() => setDeleting(null)}
          confirm={() => setRows(rows.filter((r) => r.id !== deleting.id))}
        />
      )}
    </>
  );
}

export function Contacts({ portal, policy }: Portal & { policy: () => void }) {
  const [rows, setRows] = useState<Row[]>([
    {
      id: "c1",
      name: "Team Treasury",
      address: address("d"),
      kind: "treasury",
      note: "Ví nhận thanh toán của đội",
      recipient: true,
      target: false,
    },
    {
      id: "c2",
      name: "MockRouter",
      address: "0xe20967C615e442991D468ed7f797edcAeA1771d9",
      kind: "router",
      note: "Router mô phỏng",
      recipient: true,
      target: true,
    },
    {
      id: "c3",
      name: "Design Partner",
      address: address("e"),
      kind: "recipient",
      note: "Đối tác chưa được cấp quyền",
      recipient: false,
      target: false,
    },
  ]);
  const [edit, setEdit] = useState<Row | null | false>(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [lookalike, setLookalike] = useState<{ values: Record<string, string>; trusted: Row } | null>(null);
  function append(values: Record<string, string>) {
    setRows([...rows, { ...values, id: crypto.randomUUID(), recipient: false, target: false }]);
  }
  const columns: Column[] = [
    {
      id: "name",
      label: "Liên hệ",
      render: (r) => (
        <div>
          <div className="h3-tx-name">{r.name}</div>
          <div className="h3-tx-target">
            {r.kind === "treasury" ? "Treasury" : r.kind === "router" ? "Router" : "Người nhận"}
          </div>
        </div>
      ),
    },
    {
      id: "address",
      label: "Địa chỉ",
      render: (r) => (
        <button className="wx-address-button" onClick={() => setEdit(r)} aria-label={"Xem địa chỉ " + r.name}>
          <code>{short(r.address)}</code>
        </button>
      ),
    },
    {
      id: "allowed",
      label: "Allowlist on-chain",
      render: (r) => (
        <div className="wx-tags">
          {r.recipient && <Tag color="success">Người nhận</Tag>}
          {r.target && <Tag>Contract</Tag>}
          {!r.recipient && !r.target && <Tag>Chưa cấp quyền</Tag>}
        </div>
      ),
    },
    {
      id: "actions",
      label: "",
      render: (r) => (
        <div className="wx-row-actions">
          <Button variant="secondary" size="sm" onPress={() => setEdit(r)}>
            Sửa
          </Button>
          <Button variant="ghost" size="sm" onPress={() => setDeleting(r)}>
            Xoá
          </Button>
        </div>
      ),
    },
  ];
  return (
    <>
      <Card className="h3-panel wx-resource">
        <Card.Header>
          <div className="h3-card-heading">
            <div>
              <Card.Title>Danh bạ đáng tin cậy</Card.Title>
              <Card.Description>Nhận diện người nhận và contract trước khi cấp quyền.</Card.Description>
            </div>
            <Button onPress={() => setEdit(null)}>+ Thêm liên hệ</Button>
          </div>
        </Card.Header>
        <Card.Content>
          <ResourceTable rows={rows} columns={columns} label="Danh bạ vault" />
        </Card.Content>
        <Card.Footer className="wx-panel-foot">
          <span>Lưu liên hệ không thêm địa chỉ vào allowlist.</span>
          <Button variant="ghost" size="sm" onPress={policy}>
            Chỉnh allowlist →
          </Button>
        </Card.Footer>
      </Card>
      {edit !== false && (
        <Editor
          key={edit?.id || "new"}
          portal={portal}
          title={edit ? "Chỉnh sửa liên hệ" : "Thêm liên hệ"}
          close={() => setEdit(false)}
          note="Địa chỉ đã lưu không thể sửa. Xoá và thêm lại để kiểm tra địa chỉ nhái."
          fields={[
            { key: "name", label: "Tên liên hệ", value: edit?.name || "" },
            { key: "address", label: "Địa chỉ đầy đủ", value: edit?.address || "", readonly: !!edit },
            {
              key: "kind",
              label: "Phân loại",
              value: edit?.kind || "recipient",
              options: [
                ["recipient", "Người nhận"],
                ["treasury", "Treasury"],
                ["router", "Router"],
                ["other", "Khác"],
              ],
            },
            { key: "note", label: "Ghi chú", value: edit?.note || "" },
          ]}
          save={(values) => {
            if (!values.name.trim()) return "Nhập tên liên hệ.";
            if (!/^0x[0-9a-fA-F]{40}$/.test(values.address)) return "Nhập địa chỉ hợp lệ.";
            if (
              rows.some((r) => r.id !== edit?.id && r.address.toLowerCase() === values.address.toLowerCase())
            )
              return "Địa chỉ đã có trong danh bạ.";
            if (edit) {
              setRows(rows.map((r) => (r.id === edit.id ? { ...r, ...values } : r)));
              return;
            }
            const match = rows.find(
              (r) =>
                r.address.toLowerCase() !== values.address.toLowerCase() &&
                r.address.slice(2, 5).toLowerCase() === values.address.slice(2, 5).toLowerCase() &&
                r.address.slice(-3).toLowerCase() === values.address.slice(-3).toLowerCase(),
            );
            if (match) {
              setLookalike({ values, trusted: match });
              return;
            }
            append(values);
          }}
        />
      )}
      {lookalike && (
        <Dialog
          portal={portal}
          open
          title="Địa chỉ gần giống liên hệ đã biết"
          close={() => setLookalike(null)}
        >
          <p className="h3-review-summary">
            Ba ký tự đầu và cuối khớp {lookalike.trusted.name}, nhưng đây là hai địa chỉ khác nhau.
          </p>
          <div className="h3-addresses">
            <div>
              <span>Địa chỉ đã biết</span>
              <code>{lookalike.trusted.address}</code>
            </div>
            <div>
              <span>Địa chỉ vừa nhập</span>
              <code>{lookalike.values.address}</code>
            </div>
          </div>
          <div className="wx-form-actions">
            <Button variant="secondary" onPress={() => setLookalike(null)}>
              Huỷ
            </Button>
            <Button
              variant="danger-soft"
              onPress={() => {
                append(lookalike.values);
                setLookalike(null);
              }}
            >
              Lưu ngoại lệ trong concept
            </Button>
          </div>
        </Dialog>
      )}
      {deleting && (
        <Confirm
          portal={portal}
          title="Xoá liên hệ?"
          note="Chỉ xoá khỏi danh bạ. Quyền allowlist on-chain không thay đổi."
          close={() => setDeleting(null)}
          confirm={() => setRows(rows.filter((r) => r.id !== deleting.id))}
        />
      )}
    </>
  );
}

export function Policies({
  portal,
  cap,
  onCapChange,
}: Portal & { cap: number; onCapChange: (value: number) => void }) {
  const [input, setInput] = useState("10.00");
  const [draft, setDraft] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row[]>([
    {
      id: "p0",
      name: "Hạn mức USDC mỗi ngày",
      before: "20.00",
      after: "10.00",
      status: "confirmed",
      time: "Hôm qua · mẫu",
    },
  ]);
  const [message, setMessage] = useState("");
  const value = Number(input);
  const valid =
    input.trim() !== "" &&
    Number.isFinite(value) &&
    value >= 2.4 &&
    value <= 1000000 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
  function advance() {
    if (!draft) return;
    if (draft.status === "draft") {
      setDraft({ ...draft, status: "submitted" });
    } else {
      onCapChange(Number(draft.after));
      setHistory([{ ...draft, status: "confirmed" }, ...history]);
      setDraft(null);
      setMessage("Thay đổi mẫu đã xác nhận. Không có giao dịch thật.");
    }
  }
  return (
    <>
      <Card className="h3-panel wx-resource">
        <Card.Header>
          <div className="h3-card-heading">
            <div>
              <Card.Title>Chính sách vault</Card.Title>
              <Card.Description>Trạng thái on-chain và các đề xuất thay đổi của chủ ví.</Card.Description>
            </div>
            <Tag>Owner wallet</Tag>
          </div>
        </Card.Header>
        <Card.Content>
          <Tabs defaultSelectedKey="settings" className="h3-review-tabs">
            <Tabs.ListContainer>
              <Tabs.List aria-label="Chính sách">
                <Tabs.Tab id="settings">
                  Cấu hình
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="history">
                  Lịch sử thay đổi
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel id="settings">
              <div className="h3-setting">
                <div>
                  <h3>Hạn mức USDC mỗi ngày</h3>
                  <p>Hiện tại: {cap.toFixed(2)} USDC · Đã chi 2.40 USDC.</p>
                </div>
                <label className="h3-cap-field">
                  <Input
                    type="number"
                    min={2.4}
                    step={0.01}
                    aria-label="Hạn mức USDC đề xuất"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  <span>USDC</span>
                </label>
              </div>
              <div className="h3-setting">
                <div>
                  <h3>Ngưỡng cần verdict</h3>
                  <p>Khoản chi vượt ngưỡng cần verdict Guardian hợp lệ.</p>
                </div>
                <strong>1.00 USDC</strong>
              </div>
              <div className="h3-setting">
                <div>
                  <h3>Quyền thực thi agent</h3>
                  <p>Treasury Payments · Một agent on-chain.</p>
                </div>
                <Tag color="success">Đang hoạt động · mẫu</Tag>
              </div>
              <div className="h3-setting">
                <div>
                  <h3>Allowlist</h3>
                  <p>Quyền người nhận và contract được cấu hình riêng.</p>
                </div>
                <span className="wx-small">Treasury · MockRouter</span>
              </div>
              <div className="h3-policy-footer">
                <Button
                  size="lg"
                  isDisabled={!valid || value === cap}
                  onPress={() =>
                    setDraft({
                      id: crypto.randomUUID(),
                      name: "Hạn mức USDC mỗi ngày",
                      before: cap.toFixed(2),
                      after: value.toFixed(2),
                      status: "draft",
                      time: "Vừa tạo · mẫu",
                    })
                  }
                >
                  Xem thay đổi
                </Button>
                <span role="status">
                  {!valid
                    ? "Hạn mức phải ≥ 2.40 USDC và có tối đa 2 số thập phân."
                    : message || "Chủ ví ký thay đổi trước khi policy có hiệu lực."}
                </span>
              </div>
            </Tabs.Panel>
            <Tabs.Panel id="history">
              <ResourceTable
                rows={history}
                label="Lịch sử thay đổi mẫu"
                columns={[
                  {
                    id: "change",
                    label: "Thay đổi",
                    render: (r) => (
                      <div>
                        <strong>{r.name}</strong>
                        <p className="wx-small">
                          {r.before} → {r.after} USDC
                        </p>
                      </div>
                    ),
                  },
                  {
                    id: "status",
                    label: "Trạng thái",
                    render: (r) => (
                      <Tag color={r.status === "confirmed" ? "success" : "warning"}>
                        {r.status === "confirmed" ? "Đã xác nhận · mẫu" : "Đã gửi · mẫu"}
                      </Tag>
                    ),
                  },
                  {
                    id: "time",
                    label: "Thời gian",
                    render: (r) => <span className="wx-small">{r.time}</span>,
                  },
                  {
                    id: "actions",
                    label: "",
                    render: (r) =>
                      r.status === "submitted" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            onCapChange(Number(r.after));
                            setHistory(
                              history.map((x) => (x.id === r.id ? { ...x, status: "confirmed" } : x)),
                            );
                          }}
                        >
                          Xác nhận mẫu
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </Tabs.Panel>
          </Tabs>
        </Card.Content>
      </Card>
      {draft && (
        <Dialog
          portal={portal}
          open
          title={draft.status === "draft" ? "Xác nhận thay đổi" : "Chờ xác nhận on-chain"}
          close={() => {
            if (draft.status === "submitted") setHistory([{ ...draft, status: "submitted" }, ...history]);
            setDraft(null);
          }}
        >
          <Tag color={draft.status === "draft" ? "default" : "warning"}>
            {draft.status === "draft" ? "Bản nháp" : "Đã gửi · mô phỏng"}
          </Tag>
          <p className="h3-review-summary">Hạn mức USDC mỗi ngày</p>
          <div className="wx-change">
            <div>
              <span>Hiện tại</span>
              <strong>
                {draft.before}
                <small> USDC</small>
              </strong>
            </div>
            <span aria-hidden="true">→</span>
            <div>
              <span>Đề xuất</span>
              <strong>
                {draft.after}
                <small> USDC</small>
              </strong>
            </div>
          </div>
          <p className="wx-note">
            Concept: các bước ký và xác nhận dưới đây chỉ đổi dữ liệu mẫu. Không mở ví hay phát sinh
            transaction.
          </p>
          <div className="wx-form-actions">
            <Button
              variant="secondary"
              onPress={() => {
                if (draft.status === "submitted") setHistory([{ ...draft, status: "submitted" }, ...history]);
                setDraft(null);
              }}
            >
              Đóng
            </Button>
            <Button onPress={advance}>
              {draft.status === "draft" ? "Mô phỏng ký và gửi" : "Mô phỏng xác nhận"}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function Alerts({ portal, inspect }: Portal & { inspect: () => void }) {
  const [notifications, setNotifications] = useState<Row[]>([
    {
      id: "n1",
      title: "Phát hiện địa chỉ nhái",
      detail: "Treasury Payments · ADDRESS_POISONING",
      time: "14:32",
      read: false,
    },
    {
      id: "n2",
      title: "Swap có trượt giá cao",
      detail: "MockRouter · ABNORMAL_SLIPPAGE",
      time: "14:28",
      read: false,
    },
    {
      id: "n3",
      title: "USDC đã dùng 80% hạn mức",
      detail: "Cảnh báo mẫu của ngày trước",
      time: "Hôm qua",
      read: true,
    },
  ]);
  const [rules, setRules] = useState<Row[]>([
    { id: "r1", name: "Giao dịch rủi ro cao", kind: "risk", threshold: "HIGH", enabled: true },
    { id: "r2", name: "Hạn mức sắp hết", kind: "cap_usage", threshold: "80", enabled: true },
    { id: "r3", name: "Địa chỉ nhái", kind: "rule", threshold: "ADDRESS_POISONING", enabled: false },
  ]);
  const [edit, setEdit] = useState<Row | null | false>(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  return (
    <>
      <Card className="h3-panel wx-resource">
        <Card.Header>
          <div className="h3-card-heading">
            <div>
              <Card.Title>Hộp thư cảnh báo</Card.Title>
              <Card.Description>
                {notifications.filter((n) => !n.read).length} chưa đọc · dữ liệu mẫu
              </Card.Description>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => setNotifications(notifications.map((n) => ({ ...n, read: true })))}
            >
              Đánh dấu tất cả
            </Button>
          </div>
        </Card.Header>
        <Card.Content>
          <Tabs defaultSelectedKey="inbox" className="h3-review-tabs">
            <Tabs.ListContainer>
              <Tabs.List aria-label="Cảnh báo">
                <Tabs.Tab id="inbox">
                  Hộp thư
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="rules">
                  Quy tắc cảnh báo
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel id="inbox">
              <div className="wx-notifications">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    data-tone={n.id === "n3" ? "warning" : "danger"}
                    className={"wx-notification " + (n.read ? "" : "wx-unread")}
                  >
                    <span className="wx-unread-dot" aria-label={n.read ? "Đã đọc" : "Chưa đọc"} />
                    <div>
                      <h3>{n.title}</h3>
                      <p>{n.detail}</p>
                      <span className="wx-small">{n.time}</span>
                    </div>
                    <div className="wx-row-actions">
                      {!n.read && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() =>
                            setNotifications(
                              notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
                            )
                          }
                        >
                          Đã đọc
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onPress={inspect}>
                        Xem
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Tabs.Panel>
            <Tabs.Panel id="rules">
              <div className="wx-toolbar">
                <span>Điều kiện tạo thông báo cho vault.</span>
                <Button onPress={() => setEdit(null)}>+ Thêm quy tắc</Button>
              </div>
              <ResourceTable
                rows={rules}
                label="Quy tắc cảnh báo"
                columns={[
                  {
                    id: "name",
                    label: "Quy tắc",
                    render: (r) => (
                      <div>
                        <strong>{r.name}</strong>
                        <p className="wx-small">
                          {r.kind === "cap_usage" ? "Sử dụng hạn mức ≥ " + r.threshold + "%" : r.threshold}
                        </p>
                      </div>
                    ),
                  },
                  {
                    id: "enabled",
                    label: "Trạng thái",
                    render: (r) => (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() =>
                          setRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))
                        }
                      >
                        {r.enabled ? "Đang bật" : "Đã tắt"}
                      </Button>
                    ),
                  },
                  {
                    id: "actions",
                    label: "",
                    render: (r) => (
                      <div className="wx-row-actions">
                        <Button size="sm" variant="ghost" onPress={() => setEdit(r)}>
                          Sửa
                        </Button>
                        <Button size="sm" variant="ghost" onPress={() => setDeleting(r)}>
                          Xoá
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </Tabs.Panel>
          </Tabs>
        </Card.Content>
        <Card.Footer className="wx-panel-foot">
          <span>Cảnh báo được đồng bộ khi mở hoặc làm mới hộp thư.</span>
        </Card.Footer>
      </Card>
      {edit !== false && (
        <Editor
          key={edit?.id || "new"}
          portal={portal}
          title={edit ? "Sửa quy tắc cảnh báo" : "Thêm quy tắc cảnh báo"}
          close={() => setEdit(false)}
          note="Loại quy tắc không thể sửa sau khi tạo. Đây là dữ liệu concept."
          fields={[
            { key: "name", label: "Tên quy tắc", value: edit?.name || "" },
            {
              key: "kind",
              label: "Loại",
              value: edit?.kind || "risk",
              readonly: !!edit,
              options: [
                ["risk", "Mức rủi ro"],
                ["rule", "Rule ID"],
                ["cap_usage", "Sử dụng hạn mức"],
              ],
            },
            {
              key: "threshold",
              label: "Giá trị: MEDIUM/HIGH, rule ID hoặc 1–100 (%)",
              value: edit?.threshold || "HIGH",
            },
          ]}
          save={(values) => {
            if (!values.name.trim()) return "Nhập tên quy tắc.";
            if (values.kind === "risk" && !["MEDIUM", "HIGH"].includes(values.threshold))
              return "Mức rủi ro phải là MEDIUM hoặc HIGH.";
            if (
              values.kind === "cap_usage" &&
              (!/^\d+$/.test(values.threshold) ||
                Number(values.threshold) < 1 ||
                Number(values.threshold) > 100)
            )
              return "Ngưỡng hạn mức phải từ 1 đến 100.";
            if (edit) setRules(rules.map((r) => (r.id === edit.id ? { ...r, ...values } : r)));
            else setRules([...rules, { ...values, id: crypto.randomUUID(), enabled: true }]);
          }}
        />
      )}
      {deleting && (
        <Confirm
          portal={portal}
          title="Xoá quy tắc cảnh báo?"
          note="Các thông báo mẫu đã tạo vẫn được giữ lại."
          close={() => setDeleting(null)}
          confirm={() => setRules(rules.filter((r) => r.id !== deleting.id))}
        />
      )}
    </>
  );
}

export function Account({ portal }: Portal) {
  const [name, setName] = useState("Guardian Owner");
  const [edit, setEdit] = useState(false);
  const [linked, setLinked] = useState(true);
  const [notice, setNotice] = useState("");
  return (
    <Card className="h3-panel wx-resource">
      <Card.Header>
        <Card.Title>Tài khoản và workspace</Card.Title>
        <Card.Description>Phiên tài khoản, ví đăng nhập và vault liên kết.</Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="h3-setting">
          <div>
            <h3>{name}</h3>
            <p>owner@example.com · phiên mẫu</p>
          </div>
          <Button variant="secondary" onPress={() => setEdit(true)}>
            Sửa hồ sơ
          </Button>
        </div>
        <div className="h3-setting">
          <div>
            <h3>Ví đăng nhập</h3>
            <code className="h3-mono">{address("f")}</code>
            <p>SIWE xác minh địa chỉ; ký transaction là một bước riêng.</p>
          </div>
          <Tag>Phương thức đăng nhập</Tag>
        </div>
        <div className="h3-setting">
          <div>
            <h3>{linked ? "AgentVault Treasury" : "Chưa liên kết vault"}</h3>
            <p>{linked ? "0x3f6a…7651 · Fuji testnet" : "Liên kết cần chứng minh ví sở hữu vault."}</p>
          </div>
          <Button
            variant="secondary"
            onPress={() => {
              setLinked(!linked);
              setNotice(
                linked
                  ? "Đã bỏ liên kết trong concept. Không thay đổi owner on-chain."
                  : "Đã khôi phục liên kết mẫu; không có kiểm tra owner thật.",
              );
            }}
          >
            {linked ? "Bỏ liên kết mẫu" : "Khôi phục vault mẫu"}
          </Button>
        </div>
        <div className="wx-notice" role="status">
          {notice || "Đây là phiên concept; không chứa tài khoản hay chữ ký thật."}
        </div>
      </Card.Content>
      {edit && (
        <Editor
          portal={portal}
          title="Chỉnh sửa hồ sơ"
          close={() => setEdit(false)}
          note="Chỉ lưu tên hiển thị trong concept."
          fields={[{ key: "name", label: "Tên hiển thị", value: name }]}
          save={(values) => {
            if (!values.name.trim()) return "Nhập tên hiển thị.";
            setName(values.name);
          }}
        />
      )}
    </Card>
  );
}

export function Demo({ inspect, portal }: Portal & { inspect: () => void }) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const cases = [
    ["S0", "Agent thanh toán", "1.5 USDC → Treasury", "Thành công"],
    ["S1", "Swap hợp lệ", "2 USDC → mWAVAX", "Thành công"],
    ["S2", "Rút cạn vault", "Người nhận ngoài allowlist", "Revert"],
    ["S3", "Địa chỉ nhái", "Cấp quyền cho router nhái", "Revert"],
    ["S4", "Trượt giá cao", "Pool mô phỏng lệch giá 30%", "Revert"],
    ["S5", "Phát lại verdict", "Nonce cũ hoặc hết hạn", "Revert"],
    ["S6", "Kill-switch", "Agent thực thi khi vault đã pause", "Revert"],
  ];
  return (
    <>
      <Card className="h3-panel wx-resource">
        <Card.Header>
          <Card.Title>Explore Demo</Card.Title>
          <Card.Description>Preview các kịch bản S0–S6. Bản concept không chạy testnet.</Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="wx-demo-list">
            {cases.map(([id, title, detail, result]) => (
              <div key={id}>
                <span className="wx-scenario-id">{id}</span>
                <div>
                  <strong>{title}</strong>
                  <p className="wx-small">{detail}</p>
                </div>
                <Tag color={result === "Thành công" ? "success" : "danger"}>{result}</Tag>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => setSelected([id, title, detail, result])}
                >
                  Xem kịch bản
                </Button>
              </div>
            ))}
          </div>
        </Card.Content>
        <Card.Footer className="wx-panel-foot">
          <span>Luồng chạy demo thật cần hiển thị chi phí testnet và xác nhận hành động trước khi chạy.</span>
        </Card.Footer>
      </Card>
      {selected && (
        <Dialog
          portal={portal}
          open
          title={selected[0] + " · " + selected[1]}
          close={() => setSelected(null)}
        >
          <p className="h3-review-summary">{selected[2]}</p>
          <div className="h3-setting">
            <h3>Kết quả kỳ vọng</h3>
            <Tag color={selected[3] === "Thành công" ? "success" : "danger"}>{selected[3]}</Tag>
          </div>
          <p className="wx-note">
            {selected[0] === "S0"
              ? "Chạy thật chuyển 1.5 USDC từ vault và cần verdict vì vượt ngưỡng 1 USDC."
              : selected[0] === "S6"
                ? "Chạy thật có thay đổi trạng thái pause của vault."
                : "Chạy thật cần agent runner và các dịch vụ testnet sẵn sàng."}{" "}
            Bản concept không gửi request hay transaction.
          </p>
          <div className="wx-form-actions">
            <Button variant="secondary" onPress={() => setSelected(null)}>
              Đóng
            </Button>
            <Button
              onPress={() => {
                setSelected(null);
                inspect();
              }}
            >
              Khám phá inspector mẫu
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
