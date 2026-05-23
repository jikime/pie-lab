import type { Metadata } from "next";
import { defaultDescription, siteName, siteUrl } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "Pie Chat",
    template: `%s | ${siteName}`,
  },
  description: defaultDescription,
  applicationName: "Pie Chat",
  keywords: [
    "Pie Chat",
    "pie-lab",
    "pie-chat",
    "agentic development kit",
    "LLM router",
    "AI chat",
    "pielab.ai",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Pie Chat",
    description: defaultDescription,
    url: "/",
    siteName,
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pie Chat",
    description: defaultDescription,
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/icon.svg",
  },
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
