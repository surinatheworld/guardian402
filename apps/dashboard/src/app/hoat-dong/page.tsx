"use client";
// Hoạt động: what the agent did, what was blocked and why. One list (Guardian checks, vault executions and the
// demo agent's attempts as journeys), filters, a detail drawer per item, and the alert settings.
import { Button } from "@heroui/react/button";
import { Tabs } from "@heroui/react/tabs";
import { useEffect, useState } from "react";
import { ActivityDrawer, ActivityList, ActivityState } from "@/components/activity-view";
import { Card, PageHeader } from "@/components/ui";
import { AlertSettings } from "@/components/workspace/alerts";
import { FILTER_LABEL, matchesFilter, type ActivityFilter, type ActivityItem } from "@/lib/activity";
import { useActivity } from "@/lib/activity-hooks";
import { useMe } from "@/lib/account";
import { PAGE } from "@/lib/labels";
import { useSelectedVault } from "@/lib/vault-context";

const FILTERS = Object.keys(FILTER_LABEL) as ActivityFilter[];
const PAGE_SIZE = 20;

export default function Activity() {
  const activity = useActivity(200);
  const { address: vault } = useSelectedVault();
  const linked = useMe().data?.vaults.some((v) => v.address.toLowerCase() === vault.toLowerCase()) ?? false;
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [shown, setShown] = useState(PAGE_SIZE);
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

  return (
    <>
      <PageHeader title={PAGE.activity} />

      <Card>
        <Tabs
          variant="secondary"
          selectedKey={filter}
          onSelectionChange={(k) => {
            setFilter(k as ActivityFilter);
            setShown(PAGE_SIZE);
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
        {filtered.length ? (
          <ActivityList
            items={filtered.slice(0, shown)}
            label={`Hoạt động: ${FILTER_LABEL[filter]}`}
            onOpen={setOpen}
          />
        ) : null}
        {filtered.length > shown ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            onPress={() => setShown((n) => n + PAGE_SIZE)}
          >
            Xem thêm ({filtered.length - shown})
          </Button>
        ) : filtered.length ? (
          <p className="text-center text-xs text-muted">
            {filtered.length} giao dịch · trong 200 lần kiểm tra và 20 giao dịch két gần nhất
          </p>
        ) : null}
      </Card>

      {linked ? (
        <div id="canh-bao" className="scroll-mt-24">
          <AlertSettings vault={vault} />
        </div>
      ) : null}

      <ActivityDrawer item={open} onClose={() => setOpen(null)} />
    </>
  );
}
