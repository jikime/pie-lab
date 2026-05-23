import type { Metadata } from "next";
import { QuotaPage } from "@/components/dashboard/pages/quota-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[4]);

export default function Page() {
  return <QuotaPage />;
}
