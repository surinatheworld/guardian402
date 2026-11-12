import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { DemoBanner, Sidebar, TopBar, VaultMain } from "@/components/shell";
import "./globals.css";

// Inter as a variable font with the optical-size axis (globals.css turns it on); only 400/500/600 are used.
const sans = Inter({
  subsets: ["latin", "vietnamese"],
  axes: ["opsz"],
  variable: "--font-inter",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Guardian402",
  description: "Tường lửa giao dịch và đồng ký cho ví AI agent trên Avalanche Fuji.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0e" },
  ],
};

// HeroUI switches palettes with the `dark` class (DESIGN.md). Follow the system setting before first paint.
const THEME_SCRIPT = `(()=>{try{const m=matchMedia("(prefers-color-scheme: dark)");const a=()=>{const d=m.matches;document.documentElement.classList.toggle("dark",d);document.documentElement.dataset.theme=d?"dark":"light";document.documentElement.style.colorScheme=d?"dark":"light"};a();m.addEventListener("change",a)}catch{}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <Providers>
          <a
            href="#noi-dung"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-2"
          >
            Bỏ qua tới nội dung
          </a>
          <DemoBanner />
          <div className="flex min-h-dvh">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />
              <VaultMain>{children}</VaultMain>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
