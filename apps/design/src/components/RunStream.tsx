"use client";

import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { DesignRunStatus } from "@/lib/design-protocol";
import { cn } from "@/lib/utils";

export type RunPhase = "idle" | "running" | DesignRunStatus;

export interface RunStreamProps {
  phase: RunPhase;
  statusLabel: string; // 최신 progress 라벨
  text: string; // 누적 어시스턴트 텍스트
  error: string | null;
}

// 실행 상태/스트리밍 진행 표시 (start/progress/text 이벤트 소비 결과를 표시).
export function RunStream({ phase, statusLabel, text, error }: RunStreamProps) {
  if (phase === "idle") {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <PhaseIcon phase={phase} />
        <span>{phaseHeadline(phase)}</span>
        {statusLabel && phase === "running" ? (
          <span className="text-muted-foreground">· {statusLabel}</span>
        ) : null}
      </div>

      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {text ? (
        <pre
          className={cn(
            "max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3",
            "font-mono text-xs text-muted-foreground",
          )}
        >
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function PhaseIcon({ phase }: { phase: RunPhase }) {
  switch (phase) {
    case "running":
      return <Loader2 className="size-4 animate-spin text-primary" />;
    case "succeeded":
      return <CheckCircle2 className="size-4 text-green-600" />;
    case "failed":
      return <XCircle className="size-4 text-destructive" />;
    case "aborted":
      return <AlertCircle className="size-4 text-muted-foreground" />;
    default:
      return null;
  }
}

function phaseHeadline(phase: RunPhase): string {
  switch (phase) {
    case "running":
      return "실행 중";
    case "succeeded":
      return "완료";
    case "failed":
      return "실패";
    case "aborted":
      return "중지됨";
    default:
      return "";
  }
}
