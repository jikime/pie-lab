import type { Metadata } from "next";
import { LearningPage } from "@/components/dashboard/pages/learning-page";
import { createPageMetadata, dashboardPages } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(dashboardPages[6]);

export default function Page() {
  return <LearningPage />;
}
