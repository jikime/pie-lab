"use client";

import type { DesignSkillOption } from "@/lib/design-protocol";
import { cn } from "@/lib/utils";

export interface SkillPickerProps {
  skills: DesignSkillOption[];
  value: string;
  onChange: (skillId: string) => void;
  disabled?: boolean;
}

// 디자인 스킬 단일 선택. 옵션은 서버 GET /v1/design/options에서 받아온다
// (프론트는 하드코딩하지 않음 — 게이트 1 결정).
export function SkillPicker({
  skills,
  value,
  onChange,
  disabled,
}: SkillPickerProps) {
  const selected = skills.find((skill) => skill.id === value);

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">디자인 스킬</span>
      <select
        className={cn(
          "h-10 rounded-md border border-input bg-card px-3 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          disabled && "cursor-not-allowed opacity-60",
        )}
        value={value}
        disabled={disabled || skills.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {skills.length === 0 ? (
          <option value="">불러오는 중…</option>
        ) : (
          skills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.title}
            </option>
          ))
        )}
      </select>
      {selected ? (
        <span className="text-xs text-muted-foreground">
          {selected.description}
        </span>
      ) : null}
    </label>
  );
}
