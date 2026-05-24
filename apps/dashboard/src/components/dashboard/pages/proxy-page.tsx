"use client"

import { useCallback, useMemo, useState } from "react"
import { Plus, Save, TestTube2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { dashboardApi, type ProviderConnectionsResponse, type ProxyPoolResponse } from "@/lib/api-client"
import { formatDateTime, safeErrorMessage } from "@/lib/format"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge, healthTone } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

interface ProxyData {
  pools: ProxyPoolResponse
  connections: ProviderConnectionsResponse
}

export function ProxyPage() {
  const loader = useCallback(async (): Promise<ProxyData> => {
    const [pools, connections] = await Promise.all([dashboardApi.proxyPools(), dashboardApi.providerConnections()])
    return { pools, connections }
  }, [])
  const { data, error, loading, refresh } = useApiResource(loader)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [type, setType] = useState<"http" | "vercel">("http")
  const [proxyUrl, setProxyUrl] = useState("")
  const [noProxy, setNoProxy] = useState("")
  const [strictProxy, setStrictProxy] = useState(false)
  const [selectedPoolId, setSelectedPoolId] = useState("")
  const [editName, setEditName] = useState("")
  const [editType, setEditType] = useState<"http" | "vercel">("http")
  const [editProxyUrl, setEditProxyUrl] = useState("")
  const [editNoProxy, setEditNoProxy] = useState("")
  const [editActive, setEditActive] = useState(true)
  const [editStrictProxy, setEditStrictProxy] = useState(false)
  const [bindingConnectionId, setBindingConnectionId] = useState("")
  const [bindingProxyPoolId, setBindingProxyPoolId] = useState("__none__")
  const [busy, setBusy] = useState(false)

  const selectedPool = useMemo(
    () => data?.pools.proxyPools.find((pool) => pool.id === selectedPoolId) ?? null,
    [data?.pools.proxyPools, selectedPoolId],
  )
  function selectPool(poolId: string) {
    setSelectedPoolId(poolId)
    const pool = data?.pools.proxyPools.find((item) => item.id === poolId)
    if (!pool) return
    setEditName(pool.name)
    setEditType(pool.type)
    setEditProxyUrl(pool.proxyUrl ?? "")
    setEditNoProxy(pool.noProxy ?? "")
    setEditActive(pool.isActive)
    setEditStrictProxy(pool.strictProxy === true)
  }

  function selectConnection(connectionId: string) {
    setBindingConnectionId(connectionId)
    const connection = data?.connections.connections.find((item) => item.id === connectionId)
    setBindingProxyPoolId(connection ? (getConnectionProxyPoolId(connection) ?? "__none__") : "__none__")
  }

  async function createPool() {
    setBusy(true)
    setMessage(null)
    try {
      await dashboardApi.createProxyPool({ name, type, proxyUrl, noProxy, strictProxy })
      setName("")
      setProxyUrl("")
      setNoProxy("")
      setStrictProxy(false)
      setMessage("Proxy pool created.")
      await refresh()
    } catch (createError) {
      setMessage(safeErrorMessage(createError))
    } finally {
      setBusy(false)
    }
  }

  async function updatePool() {
    if (!selectedPool) return
    setBusy(true)
    setMessage(null)
    try {
      await dashboardApi.updateProxyPool(selectedPool.id, {
        name: editName,
        type: editType,
        proxyUrl: editProxyUrl,
        noProxy: editNoProxy,
        isActive: editActive,
        strictProxy: editStrictProxy,
      })
      setMessage("Proxy pool updated.")
      await refresh()
    } catch (updateError) {
      setMessage(safeErrorMessage(updateError))
    } finally {
      setBusy(false)
    }
  }

  async function deletePool(id: string) {
    setBusy(true)
    setMessage(null)
    try {
      await dashboardApi.deleteProxyPool(id)
      if (selectedPoolId === id) setSelectedPoolId("")
      setMessage("Proxy pool removed.")
      await refresh()
    } catch (deleteError) {
      setMessage(safeErrorMessage(deleteError))
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

  async function saveBinding() {
    if (!bindingConnectionId) return
    setBusy(true)
    setMessage(null)
    try {
      await dashboardApi.assignConnectionProxyPool(bindingConnectionId, bindingProxyPoolId === "__none__" ? null : bindingProxyPoolId)
      setMessage("Connection proxy binding saved.")
      await refresh()
    } catch (bindingError) {
      setMessage(safeErrorMessage(bindingError))
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

      <DashboardSection title="Create proxy pool" description="Provider API 요청의 네트워크 경로를 명시적으로 관리합니다.">
        <div className="grid gap-3 lg:grid-cols-[1fr_140px_1.5fr_1fr_auto]">
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
          <Input value={noProxy} onChange={(event) => setNoProxy(event.target.value)} placeholder="No proxy hosts" />
          <Button type="button" onClick={() => void createPool()} disabled={busy || !name || !proxyUrl}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-lg border p-3">
          <Switch checked={strictProxy} onCheckedChange={setStrictProxy} />
          <div>
            <p className="text-sm font-medium">Strict proxy</p>
            <p className="text-xs text-muted-foreground">프록시 실패 시 직접 연결로 우회하지 않도록 표시합니다.</p>
          </div>
        </div>
        {message ? <p className="mt-3 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      </DashboardSection>

      {data ? (
        <>
          <DashboardSection title="Edit selected pool">
            <div className="grid gap-3 lg:grid-cols-[220px_1fr_140px_1.5fr_1fr_auto]">
              <Select value={selectedPoolId || "__none__"} onValueChange={(value) => selectPool(value === "__none__" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select pool" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select pool</SelectItem>
                  {data.pools.proxyPools.map((pool) => (
                    <SelectItem key={pool.id} value={pool.id}>
                      {pool.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Pool name" disabled={!selectedPool} />
              <Select value={editType} onValueChange={(value) => setEditType(value as "http" | "vercel")} disabled={!selectedPool}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="vercel">Vercel</SelectItem>
                </SelectContent>
              </Select>
              <Input value={editProxyUrl} onChange={(event) => setEditProxyUrl(event.target.value)} placeholder="Proxy URL" disabled={!selectedPool} />
              <Input value={editNoProxy} onChange={(event) => setEditNoProxy(event.target.value)} placeholder="No proxy hosts" disabled={!selectedPool} />
              <Button type="button" onClick={() => void updatePool()} disabled={busy || !selectedPool || !editName || !editProxyUrl}>
                <Save className="size-4" />
                Save
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ToggleRow label="Active" description="라우터가 이 pool을 사용할 수 있게 둡니다." checked={editActive} onChange={setEditActive} disabled={!selectedPool} />
              <ToggleRow label="Strict proxy" description="프록시 경로를 강제해야 하는 연결에 사용합니다." checked={editStrictProxy} onChange={setEditStrictProxy} disabled={!selectedPool} />
            </div>
          </DashboardSection>

          <DashboardSection title="Connection binding" description="Provider connection별로 사용할 proxy pool을 지정합니다.">
            <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_auto]">
              <Select value={bindingConnectionId || "__none__"} onValueChange={(value) => selectConnection(value === "__none__" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select connection</SelectItem>
                  {data.connections.connections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.provider} · {connection.displayName ?? connection.name ?? connection.email ?? connection.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={bindingProxyPoolId} onValueChange={setBindingProxyPoolId} disabled={!bindingConnectionId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No proxy</SelectItem>
                  {data.pools.proxyPools.map((pool) => (
                    <SelectItem key={pool.id} value={pool.id}>
                      {pool.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" onClick={() => void saveBinding()} disabled={busy || !bindingConnectionId}>
                <Save className="size-4" />
                Bind
              </Button>
            </div>
          </DashboardSection>

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
                {data.pools.proxyPools.map((pool) => (
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
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void testPool(pool.id)}>
                          <TestTube2 className="size-4" />
                          Test
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => selectPool(pool.id)}>
                          Edit
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void deletePool(pool.id)}>
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTableShell>
          </DashboardSection>

          <DashboardSection title="Current bindings">
            <DataTableShell>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Connection</th>
                  <th>Auth</th>
                  <th>Status</th>
                  <th>Proxy pool</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.connections.map((connection) => {
                  const proxyPoolId = getConnectionProxyPoolId(connection)
                  const pool = data.pools.proxyPools.find((item) => item.id === proxyPoolId)
                  return (
                    <tr key={connection.id}>
                      <td className="font-medium">{connection.provider}</td>
                      <td>{connection.displayName ?? connection.name ?? connection.email ?? connection.id}</td>
                      <td>{connection.authType}</td>
                      <td>
                        <StatusBadge tone={connection.isActive ? "success" : "neutral"}>{connection.isActive ? "active" : "inactive"}</StatusBadge>
                      </td>
                      <td>{pool?.name ?? proxyPoolId ?? "-"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </DataTableShell>
          </DashboardSection>
        </>
      ) : null}
    </>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <div>
        <Label>{label}</Label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function getConnectionProxyPoolId(connection: { providerSpecificData?: Record<string, unknown> | null }): string | null {
  const value = connection.providerSpecificData?.proxyPoolId
  return typeof value === "string" && value.trim() ? value : null
}
