"use client"

import { useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { dashboardApi, type MediaRoutesResponse } from "@/lib/api-client"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

const kindLabels: Record<string, string> = {
  embedding: "Embeddings",
  webSearch: "Web search",
  webFetch: "Web fetch",
  tts: "TTS",
  stt: "STT",
  image: "Image",
}

export function MediaPage() {
  const loader = useCallback(async (): Promise<MediaRoutesResponse> => dashboardApi.mediaRoutes(), [])
  const { data, error, loading, refresh } = useApiResource(loader)
  const grouped = useMemo(() => {
    const groups = new Map<string, MediaRoutesResponse["routes"]>()
    for (const route of data?.routes ?? []) {
      groups.set(route.kind, [...(groups.get(route.kind) ?? []), route])
    }
    return [...groups.entries()]
  }, [data?.routes])

  return (
    <>
      <PageHeader
        title="Media"
        description="Embeddings, image, TTS/STT, web search/fetch 라우팅 후보를 확인합니다."
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
          {grouped.map(([kind, routes]) => (
            <DashboardSection key={kind} title={kindLabels[kind] ?? kind} description={`Alias: auto:${kind}`}>
              <DataTableShell>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Auth</th>
                    <th>Format</th>
                    <th>Cost/query</th>
                    <th>Timeout</th>
                    <th>Default candidates</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={`${route.kind}-${route.provider}`}>
                      <td className="font-medium">{route.provider}</td>
                      <td>
                        <StatusBadge tone={route.noAuth ? "success" : "info"}>
                          {route.noAuth ? "no auth" : route.authHeader}
                        </StatusBadge>
                      </td>
                      <td>{route.format ?? "-"}</td>
                      <td>{route.costPerQuery ?? "-"}</td>
                      <td>{route.timeoutMs ? `${route.timeoutMs}ms` : "-"}</td>
                      <td className="max-w-md truncate text-muted-foreground">{route.defaultCandidates.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTableShell>
            </DashboardSection>
          ))}
        </>
      ) : null}
    </>
  )
}
