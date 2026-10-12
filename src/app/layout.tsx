import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { DEFAULT_SKIN, SKIN_STORAGE_KEY } from "@/data/skins";

const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });

export const metadata: Metadata = {
  title: "今天吃点啥 · A Random Life Machine",
  description: "拉一下绳子，让天意替你决定今天吃什么、干什么。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F8E9C4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={grotesk.variable} data-skin={DEFAULT_SKIN} suppressHydrationWarning>
      <head>
        {/* 首帧前套上记住的皮肤，避免先闪一下默认配色 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem(${JSON.stringify(SKIN_STORAGE_KEY)});if(s)document.documentElement.dataset.skin=s}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
