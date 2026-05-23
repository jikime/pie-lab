import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { defaultDescription, siteName, siteUrl } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "Pie Lab Dashboard",
    template: `%s | ${siteName}`,
  },
  description: defaultDescription,
  applicationName: "Pie Lab",
  generator: "Next.js",
  keywords: [
    "Pie Lab",
    "pie-lab",
    "agentic development kit",
    "AI model router",
    "LLM routing",
    "9router",
    "provider dashboard",
    "usage tracking",
    "quota tracking",
    "pielab.ai",
  ],
  authors: [{ name: "Pie Lab" }],
  creator: "Pie Lab",
  publisher: "Pie Lab",
  category: "technology",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Pie Lab Dashboard",
    description: defaultDescription,
    url: "/",
    siteName,
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pie Lab Dashboard",
    description: defaultDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
