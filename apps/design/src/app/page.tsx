"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArtifactPreview } from "@/components/ArtifactPreview";
import { Composer } from "@/components/Composer";
import { RunStream, type RunPhase } from "@/components/RunStream";
import { fetchDesignOptions, streamDesignRun } from "@/lib/design-api";
import type {
  ArtifactDescriptor,
  DesignSkillOption,
  DesignStreamEvent,
  DesignSystemOption,
} from "@/lib/design-protocol";

export default function HomePage() {
  // 선택지(서버에서 로드 — 프론트 하드코딩 금지).
  const [skills, setSkills] = useState<DesignSkillOption[]>([]);
  const [designSystems, setDesignSystems] = useState<DesignSystemOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // 컴포저 상태.
  const [prompt, setPrompt] = useState("");
  const [skillId, setSkillId] = useState("");
  const [designSystemId, setDesignSystemId] = useState<string | null>(null);

  // 런 상태.
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [statusLabel, setStatusLabel] = useState("");
  const [streamText, setStreamText] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ArtifactDescriptor | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // 옵션 로드. optionsLoading 초기값이 true이므로 effect 본문에서 동기 setState
  // 하지 않고 async 콜백 안에서만 상태를 갱신한다(react-hooks/set-state-in-effect).
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const options = await fetchDesignOptions(controller.signal);
        setSkills(options.skills);
        setDesignSystems(options.designSystems);
        setSkillId(options.defaultSkillId || options.skills[0]?.id || "");
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setOptionsError(
          error instanceof Error ? error.message : "옵션 로드 실패",
        );
      } finally {
        if (!controller.signal.aborted) setOptionsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  // 언마운트 시 진행 중 스트림 정리.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const isRunning = phase === "running";

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || !skillId) return;

    // 런 상태 리셋.
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    setStatusLabel("요청 보내는 중…");
    setStreamText("");
    setRunError(null);
    setRunId(null);
    setArtifact(null);

    try {
      await streamDesignRun({
        request: {
          prompt: prompt.trim(),
          skillId,
          designSystemId,
        },
        signal: controller.signal,
        onEvent: (event) => handleStreamEvent(event),
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        // AbortController.abort() → 사용자가 중지함.
        setPhase((current) => (current === "running" ? "aborted" : current));
        setStatusLabel("");
        return;
      }
      setRunError(error instanceof Error ? error.message : "실행 실패");
      setPhase("failed");
      setStatusLabel("");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }

    function handleStreamEvent(event: DesignStreamEvent): void {
      switch (event.type) {
        case "start":
          setRunId(event.runId);
          setStatusLabel("실행 시작");
          break;
        case "progress":
          setStatusLabel(event.label);
          break;
        case "text":
          setStreamText((prev) => prev + event.delta);
          break;
        case "artifact":
          // streaming → complete 모두 반영. primary 아티팩트로 최신을 사용.
          setArtifact(event.artifact);
          break;
        case "done":
          setPhase(event.status);
          setStatusLabel("");
          // done.artifacts는 전부 complete. 마지막 것을 primary로.
          if (event.artifacts.length > 0) {
            setArtifact(event.artifacts[event.artifacts.length - 1]);
          }
          break;
        case "error":
          setRunError(event.message);
          break;
        default:
          break;
      }
    }
  }, [prompt, skillId, designSystemId]);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-6">
      <header className="flex items-center gap-2">
        <Sparkles className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Pie Design Studio</h1>
        <span className="text-sm text-muted-foreground">
          brief → 단일 페이지 HTML 아티팩트
        </span>
      </header>

      {optionsError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          옵션 로드 실패: {optionsError}. 서버(`/v1/design/options`)가 실행 중인지
          확인하세요.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Composer
            prompt={prompt}
            onPromptChange={setPrompt}
            skills={skills}
            skillId={skillId}
            onSkillChange={setSkillId}
            designSystems={designSystems}
            designSystemId={designSystemId}
            onDesignSystemChange={setDesignSystemId}
            isRunning={isRunning}
            optionsLoading={optionsLoading}
            onRun={handleRun}
            onStop={handleStop}
          />
          <RunStream
            phase={phase}
            statusLabel={statusLabel}
            text={streamText}
            error={runError}
          />
        </div>

        <div className="min-h-[60vh] lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <ArtifactPreview runId={runId} artifact={artifact} />
        </div>
      </div>
    </main>
  );
}
