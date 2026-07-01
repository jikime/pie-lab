"use client";

import type { DesignSystemOption } from "@/lib/design-protocol";
import { cn } from "@/lib/utils";

// designSystemId === null = 지정 안 함(계약 4.0). select에서는 빈 문자열로 표현.
const NONE_VALUE = "";

export interface DesignSystemPickerProps {
  designSystems: DesignSystemOption[];
  value: string | null;
  onChange: (designSystemId: string | null) => void;
  disabled?: boolean;
}

export function DesignSystemPicker({
  designSystems,
  value,
  onChange,
  disabled,
}: DesignSystemPickerProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">디자인 시스템</span>
      <select
        className={cn(
          "h-10 rounded-md border border-input bg-card px-3 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          disabled && "cursor-not-allowed opacity-60",
        )}
        value={value ?? NONE_VALUE}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === NONE_VALUE ? null : next);
        }}
      >
        <option value={NONE_VALUE}>지정 안 함</option>
        {designSystems.map((option) => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </select>
    </label>
  );
}
