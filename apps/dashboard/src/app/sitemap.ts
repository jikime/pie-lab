import type { MetadataRoute } from "next";
import { dashboardPages, siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return dashboardPages.map((page) => ({
    url: new URL(page.path, siteUrl).toString(),
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: page.path === "/" ? 1 : 0.7,
  }));
}
