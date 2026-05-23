import type { Metadata } from "next";
import { SettingsPage } from "@/components/dashboard/pages/settings-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[8]);

export default function Page() {
  return <SettingsPage />;
}
