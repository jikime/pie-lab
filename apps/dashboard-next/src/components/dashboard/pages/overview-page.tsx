"use client"

import { useCallback } from "react"
import { Cable, DollarSign, Gauge, Route, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  dashboardApi,
  type ProviderConnectionsResponse,
  type ProviderStatusResponse,
  type RoutingPolicyResponse,
  type UsageSummaryResponse,
} from "@/lib/api-client"
import { formatInteger, formatUsd } from "@/lib/format"
import { DataTableShell, KeyValueGrid } from "./shared"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { MetricCard } from "../metric-card"
import { PageHeader } from "../page-header"
import { StatusBadge, healthTone } from "../status-badge"
import { useApiResource } from "../use-api-resource"

interface OverviewData {
  summary: UsageSummaryResponse
  providers: ProviderStatusResponse
  connections: ProviderConnectionsResponse
  routing: RoutingPolicyResponse
}

export function OverviewPage() {
  const loader = useCallback(async (): Promise<OverviewData> => {
    const [summary, providers, connections, routing] = await Promise.all([
      dashboardApi.usageSummary(),
      dashboardApi.providers(),
      dashboardApi.providerConnections(),
      dashboardApi.routingPolicy(),
    ])
    return { summary, providers, connections, routing }
  }, [])
  const { data, error, loading, refresh } = useApiResource(loader)

  const activeConnections = data?.connections.connections.filter((item) => item.isActive).length ?? 0
  const healthyProviders = data?.providers.data.filter((item) => item.health === "healthy").length ?? 0
  const comboCount = data?.routing.policy.combos?.length ?? 0
  const aliasCount = Object.keys(data?.routing.policy.aliases ?? {}).length

  return (
    <>
      <PageHeader
        title="Overview"
        description="pie CLI가 사용하는 router, provider, usage 상태를 메뉴별 대시보드에서 확인합니다."
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
            <MetricCard
              label="Requests"
              value={formatInteger(data.summary.summary.records)}
              detail={`${formatInteger(data.summary.summary.success)} success`}
              icon={<Gauge className="size-4" />}
            />
            <MetricCard
              label="Cost"
              value={formatUsd(data.summary.summary.costUsd)}
              detail={`${formatInteger(data.summary.summary.totalTokens)} tokens`}
              icon={<DollarSign className="size-4" />}
            />
            <MetricCard
              label="Connections"
              value={`${activeConnections}/${data.connections.count}`}
              detail="active / total"
              icon={<Cable className="size-4" />}
            />
            <MetricCard
              label="Routing"
              value={`${comboCount} combos`}
              detail={`${aliasCount} aliases`}
              icon={<Route className="size-4" />}
            />
          </div>

          <DashboardSection title="Provider health" description="현재 설정된 provider의 연결성과 quota 상태를 요약합니다.">
            <DataTableShell>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Health</th>
                  <th>Models</th>
                  <th>Connections</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.data.slice(0, 8).map((provider) => (
                  <tr key={provider.id}>
                    <td className="font-medium">{provider.name}</td>
                    <td>
                      <StatusBadge tone={healthTone(provider.health)}>{provider.health}</StatusBadge>
                    </td>
                    <td>{provider.availableModels}/{provider.models}</td>
                    <td>{provider.activeConnectionCount}/{provider.connectionCount}</td>
                    <td className="max-w-md truncate text-muted-foreground">{provider.healthReason}</td>
                  </tr>
                ))}
              </tbody>
            </DataTableShell>
          </DashboardSection>

          <DashboardSection title="Routing policy" description="auto, intent, combo 정책이 실제 모델 라우팅의 기준이 됩니다.">
            <KeyValueGrid
              rows={[
                ["healthy providers", healthyProviders],
                ["aliases", aliasCount],
                ["intents", Object.keys(data.routing.policy.intents ?? {}).length],
                ["quota-aware routing", <ShieldCheck key="quota" className="size-4 text-emerald-600" />],
              ]}
            />
          </DashboardSection>
        </>
      ) : null}
    </>
  )
}
