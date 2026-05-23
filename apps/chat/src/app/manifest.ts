import type { MetadataRoute } from "next";
import { defaultDescription } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pie Chat",
    short_name: "Pie Chat",
    description: defaultDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f2a44",
  };
}
