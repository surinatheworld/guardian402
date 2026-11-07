import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { DemoBanner, Header } from "@/components/shell";
import "./globals.css";

const sans = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Guardian402",
  description: "Tường lửa giao dịch và đồng ký cho ví AI agent trên Avalanche Fuji.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>
          <a
            href="#noi-dung"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded focus:bg-surface focus:p-2"
          >
            Bỏ qua tới nội dung
          </a>
          <DemoBanner />
          <Header />
          <main
            id="noi-dung"
            className="mx-auto flex max-w-6xl flex-col gap-5 px-[max(16px,env(safe-area-inset-left,0px))] py-6"
          >
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
