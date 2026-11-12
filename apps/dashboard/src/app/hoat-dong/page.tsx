"use client";
// Hoạt động: what the agent did, what was blocked and why. A filter, one dense table (Guardian checks, vault
// executions and the demo agent's attempts, one transaction per row), a detail drawer per row, and the alert
// settings of a linked vault.
import { ChevronLeft, ChevronRight } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Tabs } from "@heroui/react/tabs";
import { useEffect, useState } from "react";
import { ActivityDrawer, ActivityState, ActivityTable } from "@/components/activity-view";
import { PageHeader } from "@/components/ui";
import { AlertSettings } from "@/components/workspace/alerts";
import { FILTER_LABEL, matchesFilter, type ActivityFilter, type ActivityItem } from "@/lib/activity";
import { useActivity } from "@/lib/activity-hooks";
import { useMe } from "@/lib/account";
import { PAGE } from "@/lib/labels";
import { useSelectedVault } from "@/lib/vault-context";

const FILTERS = Object.keys(FILTER_LABEL) as ActivityFilter[];
const PAGE_SIZE = 12;

export default function Activity() {
  const activity = useActivity(200);
  const { address: vault } = useSelectedVault();
  const linked = useMe().data?.vaults.some((v) => v.address.toLowerCase() === vault.toLowerCase()) ?? false;
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<ActivityItem | null>(null);

  // Deep links: /hoat-dong?xem=high (the old "Đã chặn" page uses ?xem=rejected).
  useEffect(() => {
    const xem = new URLSearchParams(window.location.search).get("xem");
    if (xem && FILTERS.includes(xem as ActivityFilter)) setFilter(xem as ActivityFilter);
  }, []);

  const filtered = activity.items.filter((i) => matchesFilter(i, filter));
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, activity.items.filter((i) => matchesFilter(i, f)).length]),
  ) as Record<ActivityFilter, number>;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const first = current * PAGE_SIZE;
  const rows = filtered.slice(first, first + PAGE_SIZE);

  return (
    <>
      <PageHeader title={PAGE.activity}>
        Mỗi giao dịch của agent: Guardian chấm rủi ro, két quyết định.
      </PageHeader>

      <div className="flex flex-col gap-4">
        <Tabs
          variant="secondary"
          selectedKey={filter}
          onSelectionChange={(k) => {
            setFilter(k as ActivityFilter);
            setPage(0);
          }}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Lọc hoạt động">
              {FILTERS.map((f) => (
                <Tabs.Tab key={f} id={f} className="gap-1.5 whitespace-nowrap">
                  {FILTER_LABEL[f]}
                  {activity.items.length ? (
                    <span className="text-xs text-muted tabular-nums">{counts[f]}</span>
                  ) : null}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        <section className="overflow-hidden rounded-2xl bg-surface shadow-surface">
          <ActivityState
            isPending={activity.isPending}
            error={activity.checksError ?? activity.eventsError}
            onRetry={activity.refetch}
            empty={filtered.length === 0}
            emptyText={
              filter === "all"
                ? "Chưa có giao dịch nào. Thử một kịch bản ở trang Chạy thử."
                : `Không có giao dịch nào ở mục “${FILTER_LABEL[filter]}”.`
            }
          />
          {rows.length ? (
            <>
              <ActivityTable items={rows} label={`Hoạt động: ${FILTER_LABEL[filter]}`} onOpen={setOpen} />
              <div className="flex items-center justify-between gap-3 border-t border-separator px-4 py-2 text-sm text-muted">
                <span className="tabular-nums">
                  {first + 1}–{first + rows.length} trong {filtered.length}
                </span>
                {pages > 1 ? (
                  <div className="flex items-center gap-1">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      aria-label="Trang trước"
                      isDisabled={current === 0}
                      onPress={() => setPage(current - 1)}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <span className="px-1 tabular-nums">
                      Trang {current + 1}/{pages}
                    </span>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      aria-label="Trang sau"
                      isDisabled={current >= pages - 1}
                      onPress={() => setPage(current + 1)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      </div>

      {linked ? (
        <div id="canh-bao" className="scroll-mt-24">
          <AlertSettings vault={vault} />
        </div>
      ) : null}

      <ActivityDrawer item={open} onClose={() => setOpen(null)} />
    </>
  );
}
