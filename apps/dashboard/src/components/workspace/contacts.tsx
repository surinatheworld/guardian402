"use client";
// Danh bạ tab: counterparties of the vault with their live allowlist state, and the lookalike guard.
import { Button } from "@heroui/react/button";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { AccountApiError } from "@/lib/account";
import { AddressLink, Card, Empty, ErrorBox, Loading } from "@/components/ui";
import { ConfirmInline, Field, FormError, INPUT, Pill, errorOf } from "@/components/form";
import { CONTACT_KIND_LABEL, useContacts, useInvalidate, wsApi, type Contact } from "@/lib/workspace";

export function ContactsTab({ vault, onDraftCreated }: { vault: string; onDraftCreated: () => void }) {
  const q = useContacts(vault);
  const invalidate = useInvalidate(vault);
  if (q.isPending) return <Loading label="Đang đọc danh bạ và trạng thái allowlist trên chain…" />;
  if (q.isError)
    return (
      <ErrorBox title="Không đọc được danh bạ" detail={errorOf(q.error)} onRetry={() => void q.refetch()} />
    );
  return (
    <div className="flex flex-col gap-6">
      <Card title="Danh bạ">
        <p className="text-sm text-muted">
          Trạng thái “được phép nhận” đọc trực tiếp từ vault. Agent chỉ chuyển tiền được tới địa chỉ được
          phép.
        </p>
        {q.data.contacts.length === 0 ? (
          <Empty>Chưa có địa chỉ nào trong danh bạ.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data.contacts.map((c) => (
              <ContactItem
                key={c.id}
                vault={vault}
                contact={c}
                onChanged={() => invalidate("contacts")}
                onDraftCreated={() => {
                  void invalidate("policy");
                  onDraftCreated();
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      <AddContact vault={vault} onAdded={() => invalidate("contacts")} />
    </div>
  );
}

function ContactItem({
  vault,
  contact,
  onChanged,
  onDraftCreated,
}: {
  vault: string;
  contact: Contact;
  onChanged: () => void;
  onDraftCreated: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => wsApi(vault, `contacts/${contact.id}`, "DELETE"),
    onSuccess: onChanged,
  });
  const draft = useMutation({
    mutationFn: (allowed: boolean) =>
      wsApi(vault, "policy-changes", "POST", {
        kind: "allow_recipient",
        params: { address: contact.address, allowed },
        note: `${allowed ? "Cho phép" : "Gỡ quyền"} nhận tiền: ${contact.name}`,
      }),
    onSuccess: onDraftCreated,
  });
  const allowed = contact.allowlisted.recipient;
  return (
    <li className="flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{contact.name}</span>
        <Pill>{CONTACT_KIND_LABEL[contact.kind]}</Pill>
        {allowed ? <Pill tone="ok">Được phép nhận</Pill> : <Pill tone="warn">Chưa được phép nhận</Pill>}
        {contact.allowlisted.target ? <Pill tone="ok">Được phép gọi</Pill> : null}
      </div>
      <AddressLink address={contact.address} />
      {contact.note ? <p className="text-sm text-muted">{contact.note}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          type="button"
          isDisabled={draft.isPending}
          onPress={() => draft.mutate(!allowed)}
        >
          {allowed ? "Soạn thay đổi: gỡ quyền nhận" : "Soạn thay đổi: cho phép nhận"}
        </Button>
        {confirm ? (
          <ConfirmInline
            text="Xoá khỏi danh bạ? (Không đổi allowlist trên chain.)"
            confirmLabel="Xoá"
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
            onCancel={() => setConfirm(false)}
          />
        ) : (
          <Button variant="secondary" type="button" onPress={() => setConfirm(true)}>
            Xoá
          </Button>
        )}
      </div>
      <FormError error={draft.error ?? remove.error} />
    </li>
  );
}

function AddContact({ vault, onAdded }: { vault: string; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [kind, setKind] = useState<Contact["kind"]>("recipient");
  const [note, setNote] = useState("");
  const [confirmLookalike, setConfirmLookalike] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      wsApi(vault, "contacts", "POST", { name, address: address.trim(), kind, note, confirmLookalike }),
    onSuccess: () => {
      setName("");
      setAddress("");
      setNote("");
      setConfirmLookalike(false);
      onAdded();
    },
  });
  const lookalike = add.error instanceof AccountApiError && add.error.code === "lookalike";
  return (
    <Card title="Thêm địa chỉ">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="contact-name" label="Tên">
            <input
              id="contact-name"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
            />
          </Field>
          <Field id="contact-address" label="Địa chỉ (0x…)">
            <input
              id="contact-address"
              required
              spellCheck={false}
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setConfirmLookalike(false);
              }}
              className={`${INPUT} font-mono`}
            />
          </Field>
          <Field id="contact-kind" label="Loại">
            <select
              id="contact-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as Contact["kind"])}
              className={INPUT}
            >
              {Object.entries(CONTACT_KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field id="contact-note" label="Ghi chú (không bắt buộc)">
            <input
              id="contact-note"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>
        {lookalike ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg bg-high-bg p-3 text-sm text-high">
            <p className="font-semibold">Cảnh báo địa chỉ nhái</p>
            <p>{errorOf(add.error)}</p>
            <label className="flex items-center gap-2 text-fg">
              <input
                type="checkbox"
                checked={confirmLookalike}
                onChange={(e) => setConfirmLookalike(e.target.checked)}
              />
              Tôi đã so từng ký tự với nguồn tin cậy và vẫn muốn lưu địa chỉ này
            </label>
          </div>
        ) : (
          <FormError error={add.error} />
        )}
        <Button variant="primary" type="submit" isDisabled={add.isPending} className="self-start">
          {add.isPending ? "Đang lưu…" : "Lưu vào danh bạ"}
        </Button>
      </form>
    </Card>
  );
}
