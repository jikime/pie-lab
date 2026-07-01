"use client";

import { Loader2, Play, Square } from "lucide-react";
import type {
  DesignSkillOption,
  DesignSystemOption,
} from "@/lib/design-protocol";
import { cn } from "@/lib/utils";
import { DesignSystemPicker } from "./DesignSystemPicker";
import { SkillPicker } from "./SkillPicker";

export interface ComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  skills: DesignSkillOption[];
  skillId: string;
  onSkillChange: (skillId: string) => void;
  designSystems: DesignSystemOption[];
  designSystemId: string | null;
  onDesignSystemChange: (id: string | null) => void;
  isRunning: boolean;
  optionsLoading: boolean;
  onRun: () => void;
  onStop: () => void;
}

// Home 컴포저: brief 입력 + 디자인 스킬 select + 디자인시스템 select + Run.
// open-design HomeView/HomeHero의 Lexical 에디터 → 단순 <textarea>로 축소.
export function Composer({
  prompt,
  onPromptChange,
  skills,
  skillId,
  onSkillChange,
  designSystems,
  designSystemId,
  onDesignSystemChange,
  isRunning,
  optionsLoading,
  onRun,
  onStop,
}: ComposerProps) {
  const canRun = prompt.trim().length > 0 && skillId.length > 0 && !isRunning;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Brief</span>
        <textarea
          className={cn(
            "min-h-32 resize-y rounded-md border border-input bg-card p-3 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          )}
          placeholder="만들고 싶은 단일 페이지 HTML을 설명하세요. 예: 'SaaS 랜딩 페이지 — 히어로, 기능 3개, 가격표, 푸터'"
          value={prompt}
          disabled={isRunning}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (canRun) onRun();
            }
          }}
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SkillPicker
          skills={skills}
          value={skillId}
          onChange={onSkillChange}
          disabled={isRunning || optionsLoading}
        />
        <DesignSystemPicker
          designSystems={designSystems}
          value={designSystemId}
          onChange={onDesignSystemChange}
          disabled={isRunning || optionsLoading}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          ⌘/Ctrl + Enter 로 실행
        </span>
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium",
              "bg-destructive text-white hover:opacity-90",
            )}
          >
            <Square className="size-4" />
            중지
          </button>
        ) : (
          <button
            type="button"
            onClick={onRun}
            disabled={!canRun}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium",
              "bg-primary text-primary-foreground hover:opacity-90",
              !canRun && "cursor-not-allowed opacity-50",
            )}
          >
            {optionsLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            실행
          </button>
        )}
      </div>
    </div>
  );
}
