import type { ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function MetricCard({
  label,
  value,
  detail,
  icon,
  className,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn("rounded-lg", className)}>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</p>
          <div className="mt-2 truncate text-2xl font-semibold">{value}</div>
          {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
        </div>
        {icon ? <div className="rounded-md border bg-muted p-2 text-muted-foreground">{icon}</div> : null}
      </CardContent>
    </Card>
  )
}
