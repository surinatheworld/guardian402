import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { DemoBanner, Header, WorkspaceBar } from "@/components/shell";
import "./globals.css";
import "./concept.css";

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
          <div className="h3-theme">
            <div className="h3-shell mx-auto max-w-[1600px]">
              <Header />
              <div className="h3-main">
                <WorkspaceBar />
                <main id="noi-dung" className="h3-content flex flex-col gap-6">
                  {children}
                </main>
              </div>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
