import { Button } from "@heroui/react/button";
import type { Address } from "viem";
import { AddressLink } from "@/components/ui";

export function PolicyStageHeader({
  title,
  caption,
  vault,
  vaultLabel,
  exitLabel,
  onExit,
  busy = false,
}: {
  title: string;
  caption?: string | undefined;
  vault: Address;
  vaultLabel: string;
  exitLabel: string;
  onExit: () => void;
  busy?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight wrap-anywhere sm:text-3xl">{title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span className="wrap-anywhere">{vaultLabel}</span>
          <AddressLink address={vault} />
          {caption ? <span className="wrap-anywhere">· {caption}</span> : null}
        </div>
      </div>
      <Button variant="ghost" type="button" isDisabled={busy} onPress={onExit}>
        {exitLabel}
      </Button>
    </header>
  );
}
