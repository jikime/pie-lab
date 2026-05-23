"use client"

import { useCallback } from "react"
import { Button } from "@/components/ui/button"
import { dashboardApi, type AccountSelectionResponse, type ProviderQuotaResponse } from "@/lib/api-client"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

interface QuotaData {
  quota: ProviderQuotaResponse
  selection: AccountSelectionResponse
}

export function QuotaPage() {
  const loader = useCallback(async (): Promise<QuotaData> => {
    const [quota, selection] = await Promise.all([dashboardApi.quota(), dashboardApi.accountSelection()])
    return { quota, selection }
  }, [])
  const { data, error, loading, refresh } = useApiResource(loader)

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
                  </tr>
                ))}
              </tbody>
            </DataTableShell>
          </DashboardSection>

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
        </>
      ) : null}
    </>
  )
}
