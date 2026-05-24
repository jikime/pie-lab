"use client"

import { useCallback, useEffect, useState } from "react"
import { FileSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { dashboardApi, type UsageDetailResponse, type UsageResponse, type UsageSummaryResponse, type UsageTraceEvent } from "@/lib/api-client"
import { compactJson, formatDateTime, formatInteger, formatUsd, safeErrorMessage } from "@/lib/format"
import { EmptyPanel, ErrorPanel, InlineLoading, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { MetricCard } from "../metric-card"
import { PageHeader } from "../page-header"
import { StatusBadge, healthTone } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

interface UsageData {
  usage: UsageResponse
  summary: UsageSummaryResponse
}

export function UsagePage() {
  const loader = useCallback(async (): Promise<UsageData> => {
    const [usage, summary] = await Promise.all([dashboardApi.usage(100), dashboardApi.usageSummary()])
    return { usage, summary }
  }, [])
  const { data, error, loading, refresh } = useApiResource(loader)

  return (
    <>
      <PageHeader
        title="Usage"
        description="라우팅 결과, 토큰 사용량, 추정 비용을 함께 확인합니다."
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Records" value={formatInteger(data.summary.summary.records)} />
            <MetricCard label="Success" value={formatInteger(data.summary.summary.success)} />
            <MetricCard label="Tokens" value={formatInteger(data.summary.summary.totalTokens)} />
            <MetricCard label="Cost" value={formatUsd(data.summary.summary.costUsd)} />
          </div>

          <Tabs defaultValue="records">
            <TabsList>
              <TabsTrigger value="records">Records</TabsTrigger>
              <TabsTrigger value="providers">Providers</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="origins">Origins</TabsTrigger>
              <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
            </TabsList>
            <TabsContent value="records" className="mt-4">
              <UsageRecordsTable data={data.usage} />
            </TabsContent>
            <TabsContent value="providers" className="mt-4">
              <SummaryGroupTable title="By provider" groups={data.summary.summary.byProvider} />
            </TabsContent>
            <TabsContent value="models" className="mt-4">
              <SummaryGroupTable title="By model" groups={data.summary.summary.byModel} />
            </TabsContent>
            <TabsContent value="origins" className="mt-4">
              <SummaryGroupTable title="By client origin" groups={data.summary.summary.byClientOrigin} />
            </TabsContent>
            <TabsContent value="endpoints" className="mt-4">
              <SummaryGroupTable title="By endpoint" groups={data.summary.summary.byEndpoint} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </>
  )
}

export function UsageRecordsTable({ data, title = "Recent records" }: { data: UsageResponse; title?: string }) {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)

  return (
    <>
      <DashboardSection title={title}>
        <DataTableShell>
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>Endpoint</th>
              <th>Origin</th>
              <th>Requested</th>
              <th>Resolved</th>
              <th>Route</th>
              <th>Attempt</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.records.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center text-muted-foreground">
                  No records
                </td>
              </tr>
            ) : (
              data.records.map((record) => (
                <tr key={record.id}>
                  <td>{formatDateTime(record.timestamp)}</td>
                  <td>
                    <StatusBadge tone={healthTone(record.status)}>{record.status}</StatusBadge>
                  </td>
                  <td className="max-w-[180px] truncate text-muted-foreground">{record.endpoint ?? "-"}</td>
                  <td className="max-w-[160px] truncate text-muted-foreground">{record.clientOrigin ?? "-"}</td>
                  <td className="max-w-[220px] truncate">{record.requestedModel}</td>
                  <td className="max-w-[260px] truncate text-muted-foreground">
                    {record.resolvedProvider}/{record.resolvedModel}
                  </td>
                  <td>{record.routeSource ?? record.routingMode}</td>
                  <td>
                    {record.attemptIndex + 1}/{record.attemptCount}
                  </td>
                  <td>{formatInteger(record.usage?.totalTokens ?? (record.inputTokens ?? 0) + (record.outputTokens ?? 0))}</td>
                  <td>{formatUsd(record.cost?.total ?? record.costUsd)}</td>
                  <td>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedRequestId(record.requestId)}>
                      <FileSearch className="size-4" />
                      Detail
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTableShell>
      </DashboardSection>

      <RequestDetailSheet requestId={selectedRequestId} onOpenChange={(open) => !open && setSelectedRequestId(null)} />
    </>
  )
}

function RequestDetailSheet({
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
          <SheetTitle>{requestId ?? "Request detail"}</SheetTitle>
          <SheetDescription>Fallback timeline, cost summary, and raw event trace.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-4">
            {requestId ? <RequestDetailLoader key={requestId} requestId={requestId} /> : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function RequestDetailLoader({ requestId }: { requestId: string }) {
  const [state, setState] = useState<{
    detail: UsageDetailResponse | null
    error: string | null
    loading: boolean
  }>({ detail: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    let ignored = false

    async function loadDetail() {
      try {
        const detail = await dashboardApi.usageDetail(requestId, { signal: controller.signal })
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
  }, [requestId])

  if (state.loading) return <InlineLoading label="Loading request detail" />
  if (state.error) return <ErrorPanel message={state.error} />
  if (state.detail) return <RequestDetailContent detail={state.detail} />
  return <EmptyPanel title="No detail records" />
}

function RequestDetailContent({ detail }: { detail: UsageDetailResponse }) {
  const trace = detail.trace ?? []

  if (detail.timeline.length === 0) {
    return <EmptyPanel title="No detail records" description="이 requestId로 저장된 usage record가 없습니다." />
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryBox label="Attempts" value={formatInteger(detail.count)} />
        <SummaryBox label="Success" value={formatInteger(detail.summary.success)} />
        <SummaryBox label="Errors" value={formatInteger(detail.summary.error + detail.summary.aborted + detail.summary.skipped)} />
        <SummaryBox label="Tokens" value={formatInteger(detail.summary.totalTokens)} />
        <SummaryBox label="Cost" value={formatUsd(detail.summary.costUsd)} />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Fallback timeline</h3>
        <div className="space-y-3">
          {detail.timeline.map((item) => (
            <div key={item.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {item.resolvedProvider}/{item.resolvedModel}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    attempt {item.attemptIndex + 1}/{item.attemptCount} · {item.routeSource ?? "-"} · {formatDateTime(item.timestamp)}
                  </div>
                </div>
                <StatusBadge tone={healthTone(item.status)}>{item.status}</StatusBadge>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                <span className="truncate">endpoint {item.endpoint ?? "-"}</span>
                <span className="truncate">origin {item.clientOrigin ?? "-"}</span>
                <span className="truncate">connection {item.connectionId ?? "-"}</span>
                <span className="sm:col-span-3 lg:col-span-1">
                  {formatInteger(item.tokens)} tokens · {formatUsd(item.costUsd)}
                </span>
              </div>
              {item.errorMessage ? <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{item.errorMessage}</p> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Raw event trace</h3>
          <span className="text-xs text-muted-foreground">{formatInteger(trace.length)} events</span>
        </div>
        {trace.length === 0 ? (
          <EmptyPanel title="No raw trace" description="이 요청에는 상세 trace event가 저장되지 않았습니다." />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <div className="max-h-[360px] overflow-auto">
              {trace.map((event) => (
                <TraceEventRow key={`${event.recordId}-${event.eventIndex}`} event={event} />
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  )
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}

function TraceEventRow({ event }: { event: UsageTraceEvent }) {
  return (
    <div className="grid gap-2 border-t px-3 py-2.5 text-xs first:border-t-0 lg:grid-cols-[130px_160px_90px_1fr]">
      <span className="text-muted-foreground">{formatDateTime(event.timestamp)}</span>
      <span className="font-medium">{event.phase}</span>
      <span className="text-muted-foreground">{event.status ?? "-"}</span>
      <span className="min-w-0 break-words text-muted-foreground">
        {event.provider && event.model ? `${event.provider}/${event.model}` : "-"}
        {event.connectionId ? ` · ${event.connectionId}` : ""}
        {event.message ? ` · ${event.message}` : ""}
        {event.metadata ? ` · ${formatTraceMetadata(event.metadata)}` : ""}
      </span>
    </div>
  )
}

function formatTraceMetadata(metadata: Record<string, unknown>): string {
  const formatted = compactJson(metadata).replace(/\s+/g, " ").trim()
  return formatted.length > 240 ? `${formatted.slice(0, 240)}...` : formatted
}

function SummaryGroupTable({
  title,
  groups,
}: {
  title: string
  groups: UsageSummaryResponse["summary"]["byProvider"]
}) {
  return (
    <DashboardSection title={title}>
      <DataTableShell>
        <thead>
          <tr>
            <th>Name</th>
            <th>Records</th>
            <th>Success</th>
            <th>Error</th>
            <th>Tokens</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <td className="font-medium">{group.key}</td>
              <td>{formatInteger(group.records)}</td>
              <td>{formatInteger(group.success)}</td>
              <td>{formatInteger(group.error)}</td>
              <td>{formatInteger(group.totalTokens)}</td>
              <td>{formatUsd(group.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </DataTableShell>
    </DashboardSection>
  )
}
