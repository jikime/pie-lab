"use client"

import { useCallback, useState } from "react"
import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { dashboardApi, type ProviderSettingsResponse } from "@/lib/api-client"
import { compactJson, safeErrorMessage } from "@/lib/format"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { KeyValueGrid } from "./shared"

export function SettingsPage() {
  const loader = useCallback(async (): Promise<ProviderSettingsResponse> => dashboardApi.providerSettings(), [])
  const { data, error, loading, refresh } = useApiResource(loader)

  return (
    <>
      <PageHeader
        title="Settings"
        description="Fallback, quota, RTK, budget 정책을 확인하고 저장합니다."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      {loading ? <LoadingPanel /> : null}
      {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : null}
      {data ? <SettingsEditor data={data} onSaved={() => void refresh()} /> : null}
    </>
  )
}

function SettingsEditor({ data, onSaved }: { data: ProviderSettingsResponse; onSaved: () => void }) {
  const [settingsText, setSettingsText] = useState(compactJson(data.settings))
  const [rtkEnabled, setRtkEnabled] = useState(data.settings.rtkEnabled !== false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const parsed = JSON.parse(settingsText)
      await dashboardApi.saveProviderSettings({ ...parsed, rtkEnabled })
      setMessage("Settings saved.")
      onSaved()
    } catch (saveError) {
      setMessage(safeErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DashboardSection title="Current policy">
        <KeyValueGrid
          rows={[
            ["fallback", data.settings.fallbackStrategy ?? "-"],
            ["quota strategy", data.settings.quotaStrategy ?? "-"],
            ["quota refresh", data.settings.quotaRefreshBeforeSelection ? "before selection" : "lazy"],
            ["rtk", <StatusBadge key="rtk" tone={data.settings.rtkEnabled === false ? "neutral" : "success"}>{data.settings.rtkEnabled === false ? "disabled" : "enabled"}</StatusBadge>],
            ["budget mode", data.settings.budgetLimits?.mode ?? "-"],
            ["request budget", data.settings.budgetLimits?.requestUsd ?? "-"],
          ]}
        />
      </DashboardSection>

      <DashboardSection
        title="Settings JSON"
        description="기존 Vite 대시보드의 설정 저장 기능을 Next.js 화면으로 옮긴 첫 버전입니다."
        actions={
          <Button type="button" onClick={() => void save()} disabled={busy}>
            <Save className="size-4" />
            Save
          </Button>
        }
      >
        <div className="mb-3 flex items-center gap-3 rounded-lg border p-3">
          <Switch checked={rtkEnabled} onCheckedChange={setRtkEnabled} />
          <div>
            <p className="text-sm font-medium">RTK token saver</p>
            <p className="text-xs text-muted-foreground">Tool result token 절약 계층을 켜거나 끕니다.</p>
          </div>
        </div>
        <Textarea value={settingsText} onChange={(event) => setSettingsText(event.target.value)} className="min-h-[360px] font-mono text-xs" />
        {message ? <p className="mt-3 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      </DashboardSection>
    </>
  )
}
