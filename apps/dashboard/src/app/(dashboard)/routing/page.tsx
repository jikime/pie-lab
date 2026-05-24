import type { Metadata } from "next";
import { RoutingPage } from "@/components/dashboard/pages/routing-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[1]);

export default function Page() {
  return <RoutingPage />;
}
