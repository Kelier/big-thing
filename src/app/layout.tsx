import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { DEFAULT_SKIN } from "@/data/skins";

const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });

export const metadata: Metadata = {
  title: "今天吃点啥 · A Random Life Machine",
  description: "拉一下绳子，让天意替你决定今天吃什么、干什么。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFF3C4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={grotesk.variable} data-skin={DEFAULT_SKIN} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
