import type { Metadata } from "next";
import { LogsPage } from "@/components/dashboard/pages/logs-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[8]);

export default function Page() {
  return <LogsPage />;
}
