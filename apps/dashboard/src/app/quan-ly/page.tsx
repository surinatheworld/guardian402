"use client";
// The old "Quản lý két" page and its tabs now live on their own pages; keep old links (and #tab hashes) working.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui";

const TARGET: Record<string, string> = {
  agent: "/agent",
  policy: "/quy-tac#bo-quy-tac",
  "danh-ba": "/quy-tac#nguoi-nhan",
  "chinh-sach": "/quy-tac#cho-ky",
  "canh-bao": "/hoat-dong#canh-bao",
  "kiem-tra": "/hoat-dong",
};

export default function LegacyManage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(TARGET[window.location.hash.slice(1)] ?? "/agent");
  }, [router]);
  return <Loading label="Đang chuyển trang…" />;
}
