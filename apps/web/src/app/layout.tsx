import type { ReactNode } from "react";

import "./globals.css";

export const metadata = {
  title: "EchoSync",
  description: "AI 同声传译工作台"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
