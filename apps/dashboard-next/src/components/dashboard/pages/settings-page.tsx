"use client"

import { useCallback, useState, type ReactNode } from "react"
import { Save, WalletCards } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { dashboardApi, type BudgetStatus, type ProviderSettingsResponse } from "@/lib/api-client"
import { compactJson, formatDateTime, formatUsd, safeErrorMessage } from "@/lib/format"
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

      <BudgetPolicyEditor data={data} onSaved={onSaved} />

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

type BudgetMode = "off" | "warn" | "block"

function BudgetPolicyEditor({ data, onSaved }: { data: ProviderSettingsResponse; onSaved: () => void }) {
  const budget = data.settings.budgetLimits ?? {}
  const [mode, setMode] = useState<BudgetMode>(normalizeBudgetMode(budget.mode))
  const [requestUsd, setRequestUsd] = useState(toInputValue(budget.requestUsd))
  const [dailyUsd, setDailyUsd] = useState(toInputValue(budget.dailyUsd))
  const [monthlyUsd, setMonthlyUsd] = useState(toInputValue(budget.monthlyUsd))
  const [provider, setProvider] = useState("")
  const [providerMode, setProviderMode] = useState<BudgetMode>("warn")
  const [providerRequestUsd, setProviderRequestUsd] = useState("")
  const [providerDailyUsd, setProviderDailyUsd] = useState("")
  const [providerMonthlyUsd, setProviderMonthlyUsd] = useState("")
  const [previewProvider, setPreviewProvider] = useState("")
  const [estimateUsd, setEstimateUsd] = useState("")
  const [preview, setPreview] = useState<BudgetStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function changeProvider(value: string) {
    setProvider(value)
    const rule = value.trim() ? budget.providerLimits?.[value.trim()] : undefined
    setProviderMode(normalizeBudgetMode(rule?.mode ?? "warn"))
    setProviderRequestUsd(toInputValue(rule?.requestUsd))
    setProviderDailyUsd(toInputValue(rule?.dailyUsd))
    setProviderMonthlyUsd(toInputValue(rule?.monthlyUsd))
  }

  async function saveBudgetPolicy() {
    setBusy(true)
    setMessage(null)
    try {
      const providerLimits = { ...(budget.providerLimits ?? {}) }
      const providerName = provider.trim()
      if (providerName) {
        providerLimits[providerName] = {
          mode: providerMode,
          requestUsd: parseNullableUsd(providerRequestUsd),
          dailyUsd: parseNullableUsd(providerDailyUsd),
          monthlyUsd: parseNullableUsd(providerMonthlyUsd),
        }
      }

      await dashboardApi.saveProviderSettings({
        ...data.settings,
        budgetLimits: {
          mode,
          requestUsd: parseNullableUsd(requestUsd),
          dailyUsd: parseNullableUsd(dailyUsd),
          monthlyUsd: parseNullableUsd(monthlyUsd),
          providerLimits,
        },
      })
      setMessage("Budget policy saved.")
      onSaved()
    } catch (saveError) {
      setMessage(safeErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function loadPreview() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await dashboardApi.budget({
        provider: previewProvider.trim() || undefined,
        estimateUsd: estimateUsd.trim() || undefined,
      })
      setPreview(result.budget)
    } catch (previewError) {
      setMessage(safeErrorMessage(previewError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardSection
      title="Budget policy"
      description="요청 단위, 일 단위, 월 단위 비용 한도를 설정하고 현재 사용량 기준으로 차단 여부를 미리 확인합니다."
      actions={
        <Button type="button" onClick={() => void saveBudgetPolicy()} disabled={busy}>
          <Save className="size-4" />
          Save budget
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <WalletCards className="size-4 text-emerald-600" />
            Global limits
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mode">
              <Select value={mode} onValueChange={(value) => setMode(value as BudgetMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="block">Block</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Request USD">
              <Input value={requestUsd} onChange={(event) => setRequestUsd(event.target.value)} placeholder="0.02" type="number" step="0.0001" />
            </Field>
            <Field label="Daily USD">
              <Input value={dailyUsd} onChange={(event) => setDailyUsd(event.target.value)} placeholder="2" type="number" step="0.0001" />
            </Field>
            <Field label="Monthly USD">
              <Input value={monthlyUsd} onChange={(event) => setMonthlyUsd(event.target.value)} placeholder="30" type="number" step="0.0001" />
            </Field>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div className="text-sm font-medium">Provider override</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider">
              <Input value={provider} onChange={(event) => changeProvider(event.target.value)} placeholder="anthropic" />
            </Field>
            <Field label="Mode">
              <Select value={providerMode} onValueChange={(value) => setProviderMode(value as BudgetMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="block">Block</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Request USD">
              <Input value={providerRequestUsd} onChange={(event) => setProviderRequestUsd(event.target.value)} type="number" step="0.0001" />
            </Field>
            <Field label="Daily USD">
              <Input value={providerDailyUsd} onChange={(event) => setProviderDailyUsd(event.target.value)} type="number" step="0.0001" />
            </Field>
            <Field label="Monthly USD">
              <Input value={providerMonthlyUsd} onChange={(event) => setProviderMonthlyUsd(event.target.value)} type="number" step="0.0001" />
            </Field>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_160px_auto]">
          <Input value={previewProvider} onChange={(event) => setPreviewProvider(event.target.value)} placeholder="Preview provider, optional" />
          <Input value={estimateUsd} onChange={(event) => setEstimateUsd(event.target.value)} placeholder="Estimate USD" type="number" step="0.0001" />
          <Button type="button" variant="outline" onClick={() => void loadPreview()} disabled={busy}>
            Preview
          </Button>
        </div>
        {preview ? <BudgetPreview budget={preview} /> : null}
      </div>

      {message ? <p className="mt-3 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
    </DashboardSection>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function BudgetPreview({ budget }: { budget: BudgetStatus }) {
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <BudgetWindow title="Daily" used={budget.daily.usedUsd} limit={budget.daily.limitUsd} percentage={budget.daily.usedPercentage} />
      <BudgetWindow title="Monthly" used={budget.monthly.usedUsd} limit={budget.monthly.limitUsd} percentage={budget.monthly.usedPercentage} />
      <div className="rounded-lg border p-3 text-sm">
        <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Decision</div>
        <div className="mt-1">
          {budget.shouldBlock ? "block" : budget.shouldWarn ? "warn" : "allow"} · mode {budget.mode} · generated {formatDateTime(budget.generatedAt)}
        </div>
      </div>
      <div className="rounded-lg border p-3 text-sm">
        <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Request limit</div>
        <div className="mt-1">
          {budget.requestLimitUsd === null ? "-" : formatUsd(budget.requestLimitUsd)}
          {budget.estimatedRequestUsd !== null ? ` · estimate ${formatUsd(budget.estimatedRequestUsd)}` : ""}
        </div>
      </div>
      {budget.violations.length > 0 ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm lg:col-span-2">
          {budget.violations.map((violation) => (
            <p key={`${violation.scope}-${violation.message}`}>{violation.message}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BudgetWindow({ title, used, limit, percentage }: { title: string; used: number; limit: number | null; percentage: number | null }) {
  const progress = Math.max(0, Math.min(100, percentage ?? 0))
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">
          {formatUsd(used)} / {limit === null ? "-" : formatUsd(limit)}
        </span>
      </div>
      <Progress value={progress} className="mt-3 h-2" />
      <p className="mt-2 text-xs text-muted-foreground">{percentage === null ? "No limit" : `${percentage.toFixed(1)}% used`}</p>
    </div>
  )
}

function normalizeBudgetMode(value: unknown): BudgetMode {
  return value === "warn" || value === "block" || value === "off" ? value : "off"
}

function toInputValue(value: unknown): string {
  return value === undefined || value === null || value === "" ? "" : String(value)
}

function parseNullableUsd(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
