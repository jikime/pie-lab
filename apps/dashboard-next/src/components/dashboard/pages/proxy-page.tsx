"use client"

import { useCallback, useState } from "react"
import { Plus, TestTube2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { dashboardApi, type ProxyPoolResponse } from "@/lib/api-client"
import { formatDateTime, safeErrorMessage } from "@/lib/format"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge, healthTone } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

export function ProxyPage() {
  const loader = useCallback(async (): Promise<ProxyPoolResponse> => dashboardApi.proxyPools(), [])
  const { data, error, loading, refresh } = useApiResource(loader)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [type, setType] = useState<"http" | "vercel">("http")
  const [proxyUrl, setProxyUrl] = useState("")
  const [busy, setBusy] = useState(false)

  async function createPool() {
    setBusy(true)
    setMessage(null)
    try {
      await dashboardApi.createProxyPool({ name, type, proxyUrl })
      setName("")
      setProxyUrl("")
      setMessage("Proxy pool created.")
      await refresh()
    } catch (createError) {
      setMessage(safeErrorMessage(createError))
    } finally {
      setBusy(false)
    }
  }

  async function testPool(id: string) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await dashboardApi.testProxyPool(id)
      setMessage(result.ok ? `Test success: ${result.elapsedMs ?? 0}ms` : `Test failed: ${result.error ?? result.status}`)
      await refresh()
    } catch (testError) {
      setMessage(safeErrorMessage(testError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Proxy"
        description="Provider 연결에 사용할 HTTP/Vercel proxy pool을 관리합니다."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      {loading ? <LoadingPanel /> : null}
      {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : null}

      <DashboardSection title="Create proxy pool" description="Claude 우회 목적이 아니라, provider API 요청의 네트워크 경로를 명시적으로 관리하는 영역입니다.">
        <div className="grid gap-3 lg:grid-cols-[1fr_140px_1.5fr_auto]">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Pool name" />
          <Select value={type} onValueChange={(value) => setType(value as "http" | "vercel")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="vercel">Vercel</SelectItem>
            </SelectContent>
          </Select>
          <Input value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="Proxy URL" />
          <Button type="button" onClick={() => void createPool()} disabled={busy || !name}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        {message ? <p className="mt-3 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      </DashboardSection>

      {data ? (
        <DashboardSection title="Proxy pools">
          <DataTableShell>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Bound</th>
                <th>Last tested</th>
                <th>Proxy URL</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.proxyPools.map((pool) => (
                <tr key={pool.id}>
                  <td className="font-medium">{pool.name}</td>
                  <td>{pool.type}</td>
                  <td>
                    <StatusBadge tone={pool.isActive ? healthTone(pool.testStatus ?? "active") : "neutral"}>
                      {pool.testStatus ?? (pool.isActive ? "active" : "inactive")}
                    </StatusBadge>
                  </td>
                  <td>{pool.boundConnectionCount ?? 0}</td>
                  <td>{formatDateTime(pool.lastTestedAt)}</td>
                  <td className="max-w-md truncate text-muted-foreground">{pool.proxyUrl ?? "-"}</td>
                  <td>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void testPool(pool.id)}>
                      <TestTube2 className="size-4" />
                      Test
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTableShell>
        </DashboardSection>
      ) : null}
    </>
  )
}
