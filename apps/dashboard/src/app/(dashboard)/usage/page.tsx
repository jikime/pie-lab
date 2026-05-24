import type { Metadata } from "next";
import { UsagePage } from "@/components/dashboard/pages/usage-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[3]);

export default function Page() {
  return <UsagePage />;
}
