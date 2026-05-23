import type { Metadata } from "next";
import { OverviewPage } from "@/components/dashboard/pages/overview-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[0]);

export default function Page() {
  return <OverviewPage />;
}
