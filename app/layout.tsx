import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibeCheck — 바이브코딩 앱 진단기",
  description: "URL만 넣으면 보안·기본상태·기술·SEO를 서버에서 안전하게 진단해 드려요.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
