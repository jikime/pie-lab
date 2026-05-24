import type { Metadata } from "next";
import { MediaPage } from "@/components/dashboard/pages/media-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[5]);

export default function Page() {
  return <MediaPage />;
}
