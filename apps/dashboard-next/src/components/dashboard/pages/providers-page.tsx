"use client"

import { useCallback } from "react"
import { Button } from "@/components/ui/button"
import { dashboardApi, type ProviderConnectionsResponse, type ProviderStatusResponse } from "@/lib/api-client"
import { formatDateTime } from "@/lib/format"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge, healthTone } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

interface ProvidersData {
  providers: ProviderStatusResponse
  connections: ProviderConnectionsResponse
}

export function ProvidersPage() {
  const loader = useCallback(async (): Promise<ProvidersData> => {
    const [providers, connections] = await Promise.all([dashboardApi.providers(), dashboardApi.providerConnections()])
    return { providers, connections }
  }, [])
  const { data, error, loading, refresh } = useApiResource(loader)

  return (
    <>
      <PageHeader
        title="Providers"
        description="LLM provider 연결, 인증 상태, 모델 가용성을 한 화면에서 확인합니다."
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
          <DashboardSection title="Provider catalog">
            <DataTableShell>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Health</th>
                  <th>Models</th>
                  <th>Quota</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.data.map((provider) => (
                  <tr key={provider.id}>
                    <td className="font-medium">{provider.name}</td>
                    <td>
                      <StatusBadge tone={healthTone(provider.health)}>{provider.health}</StatusBadge>
                    </td>
                    <td>{provider.availableModels}/{provider.models}</td>
                    <td>{provider.quotaAvailableCount}/{provider.quotaAvailableCount + provider.quotaDepletedCount}</td>
                    <td className="max-w-md truncate text-muted-foreground">{provider.healthReason}</td>
                  </tr>
                ))}
              </tbody>
            </DataTableShell>
          </DashboardSection>

          <DashboardSection title="Connections">
            <DataTableShell>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Name</th>
                  <th>Auth</th>
                  <th>Status</th>
                  <th>Last used</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.connections.map((connection) => (
                  <tr key={connection.id}>
                    <td className="font-medium">{connection.provider}</td>
                    <td>{connection.displayName ?? connection.name ?? connection.email ?? connection.id}</td>
                    <td>{connection.authType}</td>
                    <td>
                      <StatusBadge tone={connection.isActive ? "success" : "neutral"}>
                        {connection.isActive ? "active" : "inactive"}
                      </StatusBadge>
                    </td>
                    <td>{formatDateTime(connection.lastUsedAt)}</td>
                    <td className="max-w-md truncate text-muted-foreground">{String(connection.lastError ?? "-")}</td>
                  </tr>
                ))}
              </tbody>
            </DataTableShell>
          </DashboardSection>
        </>
      ) : null}
    </>
  )
}
