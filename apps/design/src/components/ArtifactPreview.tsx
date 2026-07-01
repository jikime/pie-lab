"use client";

import { Download, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { artifactUrl, resolveArtifactUrl } from "@/lib/design-api";
import type { ArtifactDescriptor } from "@/lib/design-protocol";
import { buildSrcdoc } from "@/lib/srcdoc";
import { cn } from "@/lib/utils";

export interface ArtifactPreviewProps {
  runId: string | null;
  artifact: ArtifactDescriptor | null;
}

// 샌드박스 iframe 아티팩트 미리보기.
// - sandbox="allow-scripts allow-downloads" 고정 (allow-same-origin 금지 — 계약 6.3).
// - 미리보기 우선순위(계약 4.6): inlineHtml이 있으면 srcDoc, 없으면 url을 fetch.
export function ArtifactPreview({ runId, artifact }: ArtifactPreviewProps) {
  const [fetchedHtml, setFetchedHtml] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inlineHtml = artifact?.inlineHtml ?? null;
  const url = artifact?.url ?? null;
  const isComplete = artifact?.status === "complete";

  // inlineHtml이 없고 url만 있을 때 raw HTML을 fetch한다.
  // effect 본문에서 동기 setState를 피하기 위해(react-hooks/set-state-in-effect)
  // 모든 상태 갱신을 async 콜백 안에서 수행한다.
  const shouldFetch = Boolean(artifact && isComplete && !inlineHtml && url);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      if (!shouldFetch || !url) {
        setFetchError(null);
        setFetchedHtml(null);
        return;
      }
      setFetchError(null);
      setFetchedHtml(null);
      setLoading(true);
      try {
        const response = await fetch(resolveArtifactUrl(url), {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim());
        }
        setFetchedHtml(await response.text());
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setFetchError(
          error instanceof Error ? error.message : "미리보기 로드 실패",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [shouldFetch, url]);

  const html = inlineHtml ?? fetchedHtml;
  const downloadHref =
    runId && artifact ? artifactUrl(runId, artifact.name, true) : null;
  const openHref =
    runId && artifact ? artifactUrl(runId, artifact.name, false) : null;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {artifact ? artifact.name : "미리보기"}
          </span>
          {artifact?.status === "streaming" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              생성 중
            </span>
          ) : null}
          {typeof artifact?.bytes === "number" ? (
            <span className="text-xs text-muted-foreground">
              {formatBytes(artifact.bytes)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {openHref ? (
            <a
              href={openHref}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs",
                "hover:bg-muted",
              )}
            >
              <ExternalLink className="size-3.5" />
              새 탭
            </a>
          ) : null}
          {downloadHref ? (
            <a
              href={downloadHref}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              <Download className="size-3.5" />
              다운로드
            </a>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-xl bg-white">
        {renderBody({
          artifact,
          html,
          loading,
          fetchError,
        })}
      </div>
    </div>
  );
}

interface RenderBodyArgs {
  artifact: ArtifactDescriptor | null;
  html: string | null;
  loading: boolean;
  fetchError: string | null;
}

function renderBody({ artifact, html, loading, fetchError }: RenderBodyArgs) {
  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        실행하면 단일 페이지 HTML 아티팩트가 여기에 미리보기됩니다.
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">
        미리보기 로드 실패: {fetchError}
      </div>
    );
  }

  if (html) {
    return (
      <iframe
        title={`artifact-${artifact.name}`}
        className="size-full border-0"
        sandbox="allow-scripts allow-downloads"
        srcDoc={buildSrcdoc(html)}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {loading ? "미리보기 불러오는 중…" : "아티팩트 생성 중…"}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
