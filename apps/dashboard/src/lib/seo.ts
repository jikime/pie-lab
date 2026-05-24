import type { Metadata } from "next";

const siteUrlValue = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pielab.ai";

export const siteUrl = new URL(siteUrlValue);
export const siteName = "Pie Lab";
export const defaultDescription =
  "Pie Lab is a local-first agentic development kit dashboard for model routing, provider accounts, usage, quota, and automation workflows.";

export const dashboardPages = [
  {
    path: "/",
    title: "Overview",
    description:
      "Monitor Pie Lab router health, provider status, usage, and routing policy from one dashboard.",
  },
  {
    path: "/routing",
    title: "Routing",
    description:
      "Configure and inspect model aliases, intents, fallback chains, and account selection decisions.",
  },
  {
    path: "/providers",
    title: "Providers",
    description:
      "Manage provider connectivity, account readiness, login state, and router setup for Pie Lab.",
  },
  {
    path: "/usage",
    title: "Usage",
    description:
      "Track model requests, routing outcomes, token usage, and estimated provider costs.",
  },
  {
    path: "/quota",
    title: "Quota",
    description:
      "Review quota snapshots, account scores, provider limits, and routing capacity signals.",
  },
  {
    path: "/media",
    title: "Media",
    description:
      "Inspect image, speech, transcription, embedding, and web tool routing support in Pie Lab.",
  },
  {
    path: "/learning",
    title: "Learning",
    description:
      "Inspect local memory, background learning reviews, and skill curator status.",
  },
  {
    path: "/proxy",
    title: "Proxy",
    description:
      "Monitor the local OpenAI-compatible proxy endpoint and router integration settings.",
  },
  {
    path: "/logs",
    title: "Logs",
    description:
      "Review recent router events, provider errors, routing decisions, and operational traces.",
  },
  {
    path: "/settings",
    title: "Settings",
    description:
      "Adjust Pie Lab dashboard preferences, API base URL, and router dashboard configuration.",
  },
] as const;

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
};

export function createPageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  const url = new URL(path, siteUrl).toString();
  const fullTitle = `${title} | ${siteName}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName,
      locale: "ko_KR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
    },
  };
}
