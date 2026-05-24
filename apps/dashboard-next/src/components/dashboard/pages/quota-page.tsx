"use client"

import { useCallback, useEffect, useState } from "react"
import { FileSearch, Unlock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  dashboardApi,
  type AccountSelectionResponse,
  type ModelAvailabilityConnection,
  type ModelAvailabilityResponse,
  type ProviderQuotaDetailResponse,
  type ProviderQuotaResponse,
  type ProviderQuotaWindow,
} from "@/lib/api-client"
import { formatDateTime, formatInteger, safeErrorMessage } from "@/lib/format"
import { EmptyPanel, ErrorPanel, InlineLoading, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

interface QuotaData {
  quota: ProviderQuotaResponse
  selection: AccountSelectionResponse
  availability: ModelAvailabilityResponse
}

export function QuotaPage() {
  const loader = useCallback(async (): Promise<QuotaData> => {
    const [quota, selection, availability] = await Promise.all([
      dashboardApi.quota(),
      dashboardApi.accountSelection(),
      dashboardApi.modelAvailability(),
    ])
    return { quota, selection, availability }
  }, [])
  const { data, error, loading, refresh } = useApiResource(loader)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function clearCooldown(provider: string, model: string) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await dashboardApi.clearModelCooldown(provider, model)
      setMessage(`Cooldown cleared: ${result.clearedCount} connection`)
      await refresh()
    } catch (clearError) {
      setMessage(safeErrorMessage(clearError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Quota"
        description="Provider quota와 account selection에 반영되는 quota 판단 값을 확인합니다."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      {loading ? <LoadingPanel /> : null}
      {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : null}
      {data ? (
        <>
          <DashboardSection title="Quota connections">
            <DataTableShell>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Connection</th>
                  <th>Active</th>
                  <th>Eligible</th>
                  <th>Proxy pool</th>
                  <th>Selection</th>
                  <th>Error</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.quota.data.map((connection) => (
                  <tr key={connection.id}>
                    <td className="font-medium">{connection.provider}</td>
                    <td>{connection.displayName ?? connection.name ?? connection.email ?? connection.id}</td>
                    <td>
                      <StatusBadge tone={connection.isActive ? "success" : "neutral"}>
                        {connection.isActive ? "active" : "inactive"}
                      </StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={connection.eligible ? "success" : "warning"}>
                        {connection.eligible ? "eligible" : "blocked"}
                      </StatusBadge>
                    </td>
                    <td>{connection.proxyPoolId ?? "-"}</td>
                    <td className="max-w-md truncate text-muted-foreground">
                      {connection.quotaSelection?.reason ?? connection.quotaSummary ?? connection.quotaStatus ?? "-"}
                    </td>
                    <td className="max-w-md truncate text-muted-foreground">{String(connection.lastError ?? "-")}</td>
                    <td>
                      <Button type="button" variant="outline" size="sm" onClick={() => setSelectedConnectionId(connection.id)}>
                        <FileSearch className="size-4" />
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTableShell>
          </DashboardSection>

          <ModelAvailabilityPanel availability={data.availability} busy={busy} message={message} onClear={(provider, model) => void clearCooldown(provider, model)} />

          <DashboardSection title="Account selection view">
            <DataTableShell>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Selected</th>
                  <th>Candidates</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.selection.data.map((group) => (
                  <tr key={group.provider}>
                    <td className="font-medium">{group.provider}</td>
                    <td>{group.selected?.displayName ?? group.selected?.name ?? group.selected?.email ?? "-"}</td>
                    <td>{group.candidates?.length ?? 0}</td>
                    <td className="max-w-md truncate text-muted-foreground">{group.reason ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </DataTableShell>
          </DashboardSection>

          <QuotaDetailSheet requestId={selectedConnectionId} onOpenChange={(open) => !open && setSelectedConnectionId(null)} />
        </>
      ) : null}
    </>
  )
}

function QuotaDetailSheet({
  requestId,
  onOpenChange,
}: {
  requestId: string | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={Boolean(requestId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[92vw] gap-0 sm:max-w-2xl lg:max-w-4xl">
        <SheetHeader className="border-b">
          <SheetTitle>{requestId ?? "Quota detail"}</SheetTitle>
          <SheetDescription>Provider usage bucket, quota snapshot, and account selection score.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-4">{requestId ? <QuotaDetailLoader key={requestId} connectionId={requestId} /> : null}</div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function QuotaDetailLoader({ connectionId }: { connectionId: string }) {
  const [state, setState] = useState<{
    detail: ProviderQuotaDetailResponse | null
    error: string | null
    loading: boolean
  }>({ detail: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    let ignored = false

    async function loadDetail() {
      try {
        const detail = await dashboardApi.quotaDetail(connectionId, { signal: controller.signal })
        if (!ignored) setState({ detail, error: null, loading: false })
      } catch (detailError) {
        if (!ignored && !controller.signal.aborted) {
          setState({ detail: null, error: safeErrorMessage(detailError), loading: false })
        }
      }
    }

    void loadDetail()

    return () => {
      ignored = true
      controller.abort()
    }
  }, [connectionId])

  if (state.loading) return <InlineLoading label="Loading quota detail" />
  if (state.error) return <ErrorPanel message={state.error} />
  if (state.detail) return <QuotaDetailContent detail={state.detail} />
  return <EmptyPanel title="No quota detail" />
}

function QuotaDetailContent({ detail }: { detail: ProviderQuotaDetailResponse }) {
  const connection = detail.connection
  const usage = detail.usage
  const quotas = Object.entries(usage.quotas ?? {})
  const selection = connection.quotaSelection

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryBox label="Provider" value={connection.provider} />
        <SummaryBox label="Plan" value={usage.plan ?? "-"} />
        <SummaryBox label="Selection" value={selection?.status ?? (selection?.available === false ? "blocked" : "-")} />
        <SummaryBox label="Score" value={typeof selection?.score === "number" ? selection.score.toFixed(2) : "-"} />
      </div>

      {selection ? (
        <div className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <span>checked {formatDateTime(selection.checkedAt)}</span>
          <span>remaining {typeof selection.remainingPercentage === "number" ? `${selection.remainingPercentage.toFixed(1)}%` : "-"}</span>
          <span>reset {formatResetValue(selection.resetAt)}</span>
          <span className="truncate text-muted-foreground">{selection.message ?? selection.reason ?? "-"}</span>
        </div>
      ) : null}

      {usage.message ? <p className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{usage.message}</p> : null}

      {quotas.length === 0 ? (
        <EmptyPanel title="No quota buckets" />
      ) : (
        <DataTableShell>
          <thead>
            <tr>
              <th>Quota</th>
              <th>Used</th>
              <th>Remaining</th>
              <th>Total</th>
              <th>Reset</th>
            </tr>
          </thead>
          <tbody>
            {quotas.map(([name, quota]) => (
              <QuotaWindowRow key={name} name={name} quota={quota} />
            ))}
          </tbody>
        </DataTableShell>
      )}
    </>
  )
}

function QuotaWindowRow({ name, quota }: { name: string; quota: ProviderQuotaWindow }) {
  const percent = typeof quota.remainingPercentage === "number" ? Math.max(0, Math.min(100, quota.remainingPercentage)) : null
  return (
    <tr>
      <td className="font-medium">{quota.displayName ?? name}</td>
      <td>{formatQuotaNumber(quota.used)}</td>
      <td>
        <div className="space-y-1">
          <span>{formatQuotaRemaining(quota)}</span>
          {percent === null ? null : <Progress value={percent} className="h-1.5" />}
        </div>
      </td>
      <td>{quota.unlimited ? "unlimited" : formatQuotaNumber(quota.total)}</td>
      <td>{formatResetValue(quota.resetAt)}</td>
    </tr>
  )
}

function ModelAvailabilityPanel({
  availability,
  busy,
  message,
  onClear,
}: {
  availability: ModelAvailabilityResponse
  busy: boolean
  message: string | null
  onClear: (provider: string, model: string) => void
}) {
  const rows = availability.data.flatMap((connection) =>
    connection.locks.map((lock) => ({
      connection,
      lock,
    })),
  )

  return (
    <DashboardSection
      title="Model availability"
      description={`${formatInteger(availability.lockedConnectionCount)} locked connection · ${formatInteger(availability.lockedModelCount)} locked model`}
    >
      {message ? <p className="mb-3 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      {rows.length === 0 ? (
        <EmptyPanel title="No active cooldown" />
      ) : (
        <DataTableShell>
          <thead>
            <tr>
              <th>Connection</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Retry after</th>
              <th>Until</th>
              <th>Error</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ connection, lock }) => (
              <ModelAvailabilityRow
                key={`${connection.id}-${lock.key}`}
                connection={connection}
                lock={lock}
                busy={busy}
                onClear={onClear}
              />
            ))}
          </tbody>
        </DataTableShell>
      )}
    </DashboardSection>
  )
}

function ModelAvailabilityRow({
  connection,
  lock,
  busy,
  onClear,
}: {
  connection: ModelAvailabilityConnection
  lock: ModelAvailabilityConnection["locks"][number]
  busy: boolean
  onClear: (provider: string, model: string) => void
}) {
  const connectionName = connection.displayName ?? connection.name ?? connection.email ?? connection.id
  return (
    <tr>
      <td className="font-medium">{connectionName}</td>
      <td>{connection.provider}</td>
      <td>{lock.scope === "all" ? "all models" : (lock.model ?? "-")}</td>
      <td>
        <StatusBadge tone="warning">{lock.retryAfterHuman}</StatusBadge>
      </td>
      <td>{formatDateTime(lock.until)}</td>
      <td className="max-w-md truncate text-muted-foreground">{String(connection.lastError ?? "-")}</td>
      <td>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onClear(connection.provider, lock.model ?? "__all")}>
          <Unlock className="size-4" />
          Clear
        </Button>
      </td>
    </tr>
  )
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  )
}

function formatQuotaNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-"
  return formatInteger(value)
}

function formatQuotaRemaining(quota: ProviderQuotaWindow): string {
  if (quota.unlimited) return "unlimited"
  const value = formatQuotaNumber(quota.remaining)
  return typeof quota.remainingPercentage === "number" ? `${value} (${quota.remainingPercentage.toFixed(1)}%)` : value
}

function formatResetValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-"
  if (typeof value === "number") return formatDateTime(new Date(value).toISOString())
  return formatDateTime(value)
}
