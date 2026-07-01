import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pie Design Studio",
  description:
    "Brief를 입력하면 pie agent가 단일 페이지 HTML 아티팩트를 스트리밍으로 생성합니다.",
  applicationName: "Pie Design Studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
