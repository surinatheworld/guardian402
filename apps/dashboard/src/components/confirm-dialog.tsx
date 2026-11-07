"use client";
// Confirmation before every owner transaction: shows exactly what changes (before → after).
import { useEffect, useRef, type ReactNode } from "react";

export type Change = { label: string; before: ReactNode; after: ReactNode };

export function ConfirmDialog({
  open,
  title,
  changes,
  call,
  note,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  changes: Change[];
  call: string;
  note?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(32rem,calc(100vw-32px))] rounded-xl border border-line bg-surface p-0 text-fg"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Những gì sẽ thay đổi</caption>
          <thead className="text-xs text-muted">
            <tr>
              <th scope="col" className="pb-1 font-medium">
                Mục
              </th>
              <th scope="col" className="pb-1 font-medium">
                Hiện tại
              </th>
              <th scope="col" className="pb-1 font-medium">
                Sau giao dịch
              </th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.label} className="border-t border-line align-top">
                <th scope="row" className="py-2 pr-2 font-medium">
                  {c.label}
                </th>
                <td className="py-2 pr-2 break-words">{c.before}</td>
                <td className="py-2 font-semibold break-words">{c.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rounded-lg bg-surface-2 p-2 font-mono text-xs break-all">{call}</p>
        {note ? <p className="text-sm text-muted">{note}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-2 text-sm"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg"
          >
            Xác nhận và ký trong ví
          </button>
        </div>
      </div>
    </dialog>
  );
}
