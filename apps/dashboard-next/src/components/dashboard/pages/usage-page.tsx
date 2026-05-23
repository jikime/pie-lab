"use client"

import { useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { dashboardApi, type UsageResponse, type UsageSummaryResponse } from "@/lib/api-client"
import { formatDateTime, formatInteger, formatUsd } from "@/lib/format"
import { ErrorPanel, LoadingPanel } from "../data-state"
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
          </Tabs>
        </>
      ) : null}
    </>
  )
}

export function UsageRecordsTable({ data, title = "Recent records" }: { data: UsageResponse; title?: string }) {
  return (
    <DashboardSection title={title}>
      <DataTableShell>
        <thead>
          <tr>
            <th>Time</th>
            <th>Status</th>
            <th>Requested</th>
            <th>Resolved</th>
            <th>Route</th>
            <th>Tokens</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.records.map((record) => (
            <tr key={record.id}>
              <td>{formatDateTime(record.timestamp)}</td>
              <td>
                <StatusBadge tone={healthTone(record.status)}>{record.status}</StatusBadge>
              </td>
              <td className="max-w-[220px] truncate">{record.requestedModel}</td>
              <td className="max-w-[260px] truncate text-muted-foreground">
                {record.resolvedProvider}/{record.resolvedModel}
              </td>
              <td>{record.routeSource ?? record.routingMode}</td>
              <td>{formatInteger(record.usage?.totalTokens ?? (record.inputTokens ?? 0) + (record.outputTokens ?? 0))}</td>
              <td>{formatUsd(record.cost?.total ?? record.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </DataTableShell>
    </DashboardSection>
  )
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
