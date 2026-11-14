// The 404 page, inside the app frame (navigation stays): the default Next.js one is in English and a dead end.
import NextLink from "next/link";
import { buttonVariants } from "@heroui/react/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Không tìm thấy trang này</h1>
      <p className="max-w-prose text-sm text-muted">
        Đường dẫn này không có trong Guardian402. Có thể trang đã đổi tên, hoặc đường dẫn bị gõ thiếu.
      </p>
      <NextLink href="/" className={buttonVariants({ variant: "primary" })}>
        Về Tổng quan
      </NextLink>
    </div>
  );
}
