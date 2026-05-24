import type { ReactNode } from "react"

export function DataTableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-normal [&_th]:text-muted-foreground">
        {children}
      </table>
    </div>
  )
}

export function KeyValueGrid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([key, value]) => (
        <div key={key} className="rounded-lg border p-3">
          <dt className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{key}</dt>
          <dd className="mt-1 break-words text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
