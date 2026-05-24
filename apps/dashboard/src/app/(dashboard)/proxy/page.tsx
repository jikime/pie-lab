import type { Metadata } from "next";
import { ProxyPage } from "@/components/dashboard/pages/proxy-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[7]);

export default function Page() {
  return <ProxyPage />;
}
