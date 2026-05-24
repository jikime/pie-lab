"use client"

import { useCallback, useMemo, useState } from "react"
import { Plus, Play, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  const [comboName, setComboName] = useState("")
  const [comboModels, setComboModels] = useState("")
  const [comboStrategy, setComboStrategy] = useState<"fallback" | "round-robin">("fallback")
  const [comboStickyLimit, setComboStickyLimit] = useState("1")
  const [aliasName, setAliasName] = useState("")
  const [aliasModels, setAliasModels] = useState("")
  const [intentName, setIntentName] = useState("")
  const [intentModels, setIntentModels] = useState("")

  const aliases = useMemo(() => Object.entries(data.routing.policy.aliases ?? {}), [data.routing.policy.aliases])
  const intents = useMemo(() => Object.entries(data.routing.policy.intents ?? {}), [data.routing.policy.intents])
  const combos = useMemo(
    () => (Array.isArray(data.routing.policy.combos) ? data.routing.policy.combos : []),
    [data.routing.policy.combos],
  )

  async function savePolicy() {
    setBusy(true)
    setMessage(null)
    try {
      const parsed = JSON.parse(policyText)
      const response = await dashboardApi.saveRoutingPolicy(parsed)
      setPolicyText(compactJson(response.policy))
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

  async function saveCombo() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await dashboardApi.saveRoutingCombo({
        name: comboName,
        models: comboModels,
        strategy: comboStrategy,
        stickyLimit: comboStickyLimit,
      })
      setPolicyText(compactJson(response.policy))
      setComboName("")
      setComboModels("")
      setComboStickyLimit("1")
      setMessage(`Combo saved: ${response.combo.name}`)
      onSaved()
    } catch (comboError) {
      setMessage(safeErrorMessage(comboError))
    } finally {
      setBusy(false)
    }
  }

  async function deleteCombo(name: string) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await dashboardApi.deleteRoutingCombo(name)
      setPolicyText(compactJson(response.policy))
      setMessage(`Combo deleted: ${name}`)
      onSaved()
    } catch (deleteError) {
      setMessage(safeErrorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  async function saveAlias() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await dashboardApi.saveRoutingAlias({ name: aliasName, models: aliasModels })
      setPolicyText(compactJson(response.policy))
      setAliasName("")
      setAliasModels("")
      setPreviewModel(response.alias.name)
      setMessage(`Alias saved: ${response.alias.name}`)
      onSaved()
    } catch (aliasError) {
      setMessage(safeErrorMessage(aliasError))
    } finally {
      setBusy(false)
    }
  }

  async function deleteAlias(name: string) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await dashboardApi.deleteRoutingAlias(name)
      setPolicyText(compactJson(response.policy))
      setMessage(`Alias deleted: ${name}`)
      onSaved()
    } catch (deleteError) {
      setMessage(safeErrorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  async function saveIntent() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await dashboardApi.saveRoutingIntent({ name: intentName, models: intentModels })
      setPolicyText(compactJson(response.policy))
      setIntentName("")
      setIntentModels("")
      setPreviewModel(`auto:${response.intent.name}`)
      setMessage(`Intent saved: ${response.intent.name}`)
      onSaved()
    } catch (intentError) {
      setMessage(safeErrorMessage(intentError))
    } finally {
      setBusy(false)
    }
  }

  async function deleteIntent(name: string) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await dashboardApi.deleteRoutingIntent(name)
      setPolicyText(compactJson(response.policy))
      setMessage(`Intent deleted: ${name}`)
      onSaved()
    } catch (deleteError) {
      setMessage(safeErrorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DashboardSection title="Policy forms" description="Combo, alias, intent를 기존 9router routing-policy API로 저장합니다.">
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-medium">Combo</h3>
            <Input value={comboName} onChange={(event) => setComboName(event.target.value)} placeholder="combo name" />
            <Input value={comboModels} onChange={(event) => setComboModels(event.target.value)} placeholder="provider/model, provider/model" />
            <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
              <Select value={comboStrategy} onValueChange={(value) => setComboStrategy(value as "fallback" | "round-robin")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fallback">Fallback</SelectItem>
                  <SelectItem value="round-robin">Round robin</SelectItem>
                </SelectContent>
              </Select>
              <Input value={comboStickyLimit} onChange={(event) => setComboStickyLimit(event.target.value)} placeholder="sticky" type="number" />
            </div>
            <Button type="button" onClick={() => void saveCombo()} disabled={busy || !comboName || !comboModels}>
              <Plus className="size-4" />
              Save combo
            </Button>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-medium">Alias</h3>
            <Input value={aliasName} onChange={(event) => setAliasName(event.target.value)} placeholder="auto:coding" />
            <Input value={aliasModels} onChange={(event) => setAliasModels(event.target.value)} placeholder="provider/model, provider/model" />
            <Button type="button" onClick={() => void saveAlias()} disabled={busy || !aliasName || !aliasModels}>
              <Plus className="size-4" />
              Save alias
            </Button>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-medium">Intent</h3>
            <Input value={intentName} onChange={(event) => setIntentName(event.target.value)} placeholder="coding" />
            <Input value={intentModels} onChange={(event) => setIntentModels(event.target.value)} placeholder="provider/model, provider/model" />
            <Button type="button" onClick={() => void saveIntent()} disabled={busy || !intentName || !intentModels}>
              <Plus className="size-4" />
              Save intent
            </Button>
          </div>
        </div>
      </DashboardSection>

      <DashboardSection
        title="Policy JSON"
        description="세부 정책을 직접 확인하거나 한 번에 import/export할 때 사용합니다."
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
        <DashboardSection title="Combos">
          <DataTableShell>
            <thead>
              <tr>
                <th>Name</th>
                <th>Models</th>
                <th>Strategy</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {combos.map((combo) => (
                <tr key={combo.name}>
                  <td className="font-medium">{combo.name}</td>
                  <td className="text-muted-foreground">{combo.models?.join(", ") ?? "-"}</td>
                  <td>{combo.strategy ?? "fallback"}</td>
                  <td>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void deleteCombo(combo.name)}>
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTableShell>
        </DashboardSection>

        <DashboardSection title="Aliases">
          <DataTableShell>
            <thead>
              <tr>
                <th>Name</th>
                <th>Models</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {aliases.map(([name, models]) => (
                <tr key={name}>
                  <td className="font-medium">{name}</td>
                  <td className="text-muted-foreground">{Array.isArray(models) ? models.join(", ") : models}</td>
                  <td>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void deleteAlias(name)}>
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </td>
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {intents.map(([name, models]) => (
                <tr key={name}>
                  <td className="font-medium">{name}</td>
                  <td className="text-muted-foreground">{Array.isArray(models) ? models.join(", ") : models}</td>
                  <td>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void deleteIntent(name)}>
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </td>
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
