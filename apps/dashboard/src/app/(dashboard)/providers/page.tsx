import type { Metadata } from "next";
import { ProvidersPage } from "@/components/dashboard/pages/providers-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[2]);

export default function Page() {
  return <ProvidersPage />;
}
