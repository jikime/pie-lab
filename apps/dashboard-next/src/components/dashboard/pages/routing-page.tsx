"use client"

import { useCallback, useMemo, useState } from "react"
import { Play, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  dashboardApi,
  type AccountSelectionResponse,
  type RoutingPolicyPreviewResponse,
  type RoutingPolicyResponse,
} from "@/lib/api-client"
import { compactJson, safeErrorMessage } from "@/lib/format"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

interface RoutingData {
  routing: RoutingPolicyResponse
  selection: AccountSelectionResponse
}

export function RoutingPage() {
  const loader = useCallback(async (): Promise<RoutingData> => {
    const [routing, selection] = await Promise.all([dashboardApi.routingPolicy(), dashboardApi.accountSelection()])
    return { routing, selection }
  }, [])
  const { data, error, loading, refresh } = useApiResource(loader)

  return (
    <>
      <PageHeader
        title="Routing"
        description="9router의 모델 alias, intent, combo 정책과 account selection 판단 근거를 확인합니다."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />

      {loading ? <LoadingPanel /> : null}
      {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : null}
      {data ? <RoutingEditor data={data} onSaved={() => void refresh()} /> : null}
    </>
  )
}

function RoutingEditor({ data, onSaved }: { data: RoutingData; onSaved: () => void }) {
  const [policyText, setPolicyText] = useState(compactJson(data.routing.policy))
  const [previewModel, setPreviewModel] = useState("auto:coding")
  const [preview, setPreview] = useState<RoutingPolicyPreviewResponse | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const aliases = useMemo(() => Object.entries(data.routing.policy.aliases ?? {}), [data.routing.policy.aliases])
  const intents = useMemo(() => Object.entries(data.routing.policy.intents ?? {}), [data.routing.policy.intents])

  async function savePolicy() {
    setBusy(true)
    setMessage(null)
    try {
      const parsed = JSON.parse(policyText)
      await dashboardApi.saveRoutingPolicy(parsed)
      setMessage("Routing policy saved.")
      onSaved()
    } catch (saveError) {
      setMessage(safeErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function previewPolicy() {
    setBusy(true)
    setMessage(null)
    try {
      const parsed = JSON.parse(policyText)
      setPreview(await dashboardApi.previewRoutingPolicy(previewModel, parsed))
    } catch (previewError) {
      setMessage(safeErrorMessage(previewError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DashboardSection
        title="Policy JSON"
        description="현재는 JSON 편집을 먼저 열어두었습니다. 세부 form은 이후 shadcn form 컴포넌트로 분리하면 됩니다."
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void previewPolicy()} disabled={busy}>
              <Play className="size-4" />
              Preview
            </Button>
            <Button type="button" onClick={() => void savePolicy()} disabled={busy}>
              <Save className="size-4" />
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Textarea value={policyText} onChange={(event) => setPolicyText(event.target.value)} className="min-h-[360px] font-mono text-xs" />
          <div className="space-y-3">
            <Input value={previewModel} onChange={(event) => setPreviewModel(event.target.value)} placeholder="auto:coding" />
            {message ? <p className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
            {preview ? (
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{preview.requestedModel}</span>
                  <StatusBadge tone="info">{preview.routingMode}</StatusBadge>
                </div>
                <div className="space-y-2">
                  {preview.routes.map((route) => (
                    <div key={`${route.index}-${route.id}`} className="rounded-md bg-muted px-3 py-2 text-xs">
                      <div className="font-medium">{route.id}</div>
                      <div className="text-muted-foreground">{route.source}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </DashboardSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardSection title="Aliases">
          <DataTableShell>
            <thead>
              <tr>
                <th>Name</th>
                <th>Models</th>
              </tr>
            </thead>
            <tbody>
              {aliases.map(([name, models]) => (
                <tr key={name}>
                  <td className="font-medium">{name}</td>
                  <td className="text-muted-foreground">{Array.isArray(models) ? models.join(", ") : models}</td>
                </tr>
              ))}
            </tbody>
          </DataTableShell>
        </DashboardSection>

        <DashboardSection title="Intents">
          <DataTableShell>
            <thead>
              <tr>
                <th>Name</th>
                <th>Models</th>
              </tr>
            </thead>
            <tbody>
              {intents.map(([name, models]) => (
                <tr key={name}>
                  <td className="font-medium">{name}</td>
                  <td className="text-muted-foreground">{Array.isArray(models) ? models.join(", ") : models}</td>
                </tr>
              ))}
            </tbody>
          </DataTableShell>
        </DashboardSection>
      </div>

      <DashboardSection title="Account selection" description="왜 이 계정이 선택되는지 확인하는 영역입니다.">
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
  )
}
