import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const toneClassNames = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
}

export type StatusTone = keyof typeof toneClassNames

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode
  tone?: StatusTone
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn("gap-1 rounded-md font-medium", toneClassNames[tone], className)}>
      {children}
    </Badge>
  )
}

export function healthTone(health?: string): StatusTone {
  if (health === "healthy" || health === "active" || health === "success" || health === "pass") return "success"
  if (health === "degraded" || health === "warning" || health === "warn" || health === "cooldown") return "warning"
  if (health === "missing" || health === "blocked" || health === "fail" || health === "error") return "danger"
  return "neutral"
}
