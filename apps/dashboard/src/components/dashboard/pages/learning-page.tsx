"use client"

import { useCallback, useState } from "react"
import { Archive, Check, Pin, Play, RefreshCcw, RotateCcw, Save, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  dashboardApi,
  type CuratedSkillStatus,
  type CuratorSettings,
  type LearningResponse,
  type LearningReviewRecord,
} from "@/lib/api-client"
import { formatDateTime, formatInteger, safeErrorMessage } from "@/lib/format"
import { EmptyPanel, ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { MetricCard } from "../metric-card"
import { PageHeader } from "../page-header"
import { StatusBadge, healthTone, type StatusTone } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell, KeyValueGrid } from "./shared"

export function LearningPage() {
  const loader = useCallback(async (): Promise<LearningResponse> => dashboardApi.learning(), [])
  const { data, error, loading, refresh } = useApiResource(loader)

  return (
    <>
      <PageHeader
        title="Learning"
        description="Local memory, background review, skill curator 상태를 확인하고 관리합니다."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            <RefreshCcw className="size-4" />
            Refresh
          </Button>
        }
      />
      {loading ? <LoadingPanel /> : null}
      {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : null}
      {data ? <LearningDashboard data={data} onChanged={() => void refresh()} /> : null}
    </>
  )
}

function LearningDashboard({ data, onChanged }: { data: LearningResponse; onChanged: () => void }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Review mode" value={data.settings.review.mode} />
        <MetricCard label="Reviews" value={formatInteger(data.reviews.count)} />
        <MetricCard label="Pending proposals" value={formatInteger(data.reviews.proposals)} />
        <MetricCard label="Curated skills" value={formatInteger(data.curator.status.length)} />
      </div>

      <DashboardSection title="Runtime settings">
        <KeyValueGrid
          rows={[
            ["learning", <StatusBadge key="learning" tone={data.settings.enabled ? "success" : "neutral"}>{data.settings.enabled ? "enabled" : "disabled"}</StatusBadge>],
            ["memory", <StatusBadge key="memory" tone={data.settings.memory.enabled ? "success" : "neutral"}>{data.settings.memory.enabled ? "enabled" : "disabled"}</StatusBadge>],
            ["skills", <StatusBadge key="skills" tone={data.settings.skills.enabled ? "success" : "neutral"}>{data.settings.skills.enabled ? "enabled" : "disabled"}</StatusBadge>],
            ["curator", <StatusBadge key="curator" tone={data.settings.skills.curatorEnabled ? "success" : "neutral"}>{data.settings.skills.curatorEnabled ? "enabled" : "disabled"}</StatusBadge>],
            ["honcho", <StatusBadge key="honcho" tone={data.settings.honcho.enabled ? "success" : "neutral"}>{data.settings.honcho.enabled ? "enabled" : "disabled"}</StatusBadge>],
            ["honcho session", data.settings.honcho.sessionStrategy],
          ]}
        />
      </DashboardSection>

      <MemorySection memory={data.memory.memory} user={data.memory.user} />
      <ReviewSection reviews={data.reviews.recent} mode={data.settings.review.mode} onChanged={onChanged} />
      <CuratorSection settings={data.settings.skills.curator} skills={data.curator.status} onChanged={onChanged} />
    </>
  )
}

function MemorySection({ memory, user }: { memory: string; user: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DashboardSection title="MEMORY.md">
        <MemoryBlock value={memory} />
      </DashboardSection>
      <DashboardSection title="USER.md">
        <MemoryBlock value={user} />
      </DashboardSection>
    </div>
  )
}

function MemoryBlock({ value }: { value: string }) {
  const text = value.trim()
  return (
    <pre className="max-h-[320px] min-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-6 text-muted-foreground">
      {text || "비어 있음"}
    </pre>
  )
}

function ReviewSection({
  reviews,
  mode,
  onChanged,
}: {
  reviews: LearningReviewRecord[]
  mode: LearningResponse["settings"]["review"]["mode"]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function runAction(input: Parameters<typeof dashboardApi.learningReviewAction>[0], success: string) {
    setBusy(input.action === "mode" ? `mode:${input.mode}` : `${input.action}:${input.id}`)
    setMessage(null)
    try {
      await dashboardApi.learningReviewAction(input)
      setMessage(success)
      onChanged()
    } catch (error) {
      setMessage(safeErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <DashboardSection
      title="Background reviews"
      description="suggest 모드에서는 제안을 승인해야 memory나 skill에 반영됩니다."
      actions={
        <Select value={mode} onValueChange={(value) => void runAction({ action: "mode", mode: value as typeof mode }, `Review mode: ${value}`)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">auto</SelectItem>
            <SelectItem value="suggest">suggest</SelectItem>
            <SelectItem value="off">off</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      {message ? <p className="mb-3 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      {reviews.length === 0 ? (
        <EmptyPanel title="No reviews" description="아직 background learning review 기록이 없습니다." />
      ) : (
        <DataTableShell>
          <thead>
            <tr>
              <th>Created</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Actions</th>
              <th>Model</th>
              <th>Manage</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((review) => (
              <tr key={review.id}>
                <td className="whitespace-nowrap">{formatDateTime(review.createdAt)}</td>
                <td><StatusBadge tone={healthTone(review.status)}>{review.status}</StatusBadge></td>
                <td>{review.mode}</td>
                <td>{review.results.length}/{review.actions.length}</td>
                <td className="max-w-[220px] truncate text-muted-foreground">{review.model}</td>
                <td>
                  {review.status === "proposed" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy === `approve:${review.id}`}
                        onClick={() => void runAction({ action: "approve", id: review.id }, `Approved ${review.id}`)}
                      >
                        <Check className="size-4" />
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy === `reject:${review.id}`}
                        onClick={() => void runAction({ action: "reject", id: review.id }, `Rejected ${review.id}`)}
                      >
                        <X className="size-4" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTableShell>
      )}
    </DashboardSection>
  )
}

function CuratorSection({
  settings,
  skills,
  onChanged,
}: {
  settings: CuratorSettings
  skills: CuratedSkillStatus[]
  onChanged: () => void
}) {
  const [form, setForm] = useState(settings)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function run(input: Parameters<typeof dashboardApi.curatorAction>[0], success: string) {
    setBusy(input.action)
    setMessage(null)
    try {
      await dashboardApi.curatorAction(input)
      setMessage(success)
      onChanged()
    } catch (error) {
      setMessage(safeErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <DashboardSection
      title="Skill curator"
      description="agent가 만든 skill만 정리 대상입니다. archive는 삭제가 아니라 .archive 이동입니다."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy === "run"} onClick={() => void run({ action: "run", dryRun: true }, "Curator dry run complete.")}>
            <Play className="size-4" />
            Dry run
          </Button>
          <Button type="button" disabled={busy === "run"} onClick={() => void run({ action: "run" }, "Curator run complete.")}>
            <Play className="size-4" />
            Run
          </Button>
        </div>
      }
    >
      {message ? <p className="mb-3 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      <div className="mb-4 grid gap-3 rounded-lg border p-3 md:grid-cols-5">
        <NumberField label="Stale days" value={form.staleAfterDays} onChange={(value) => setForm({ ...form, staleAfterDays: value })} />
        <NumberField label="Archive days" value={form.archiveAfterDays} onChange={(value) => setForm({ ...form, archiveAfterDays: value })} />
        <NumberField label="Prune days" value={form.pruneAfterDays} onChange={(value) => setForm({ ...form, pruneAfterDays: value })} />
        <SwitchField label="Auto archive" checked={form.autoArchive} onChange={(value) => setForm({ ...form, autoArchive: value })} />
        <SwitchField label="Backup first" checked={form.backupBeforeRun} onChange={(value) => setForm({ ...form, backupBeforeRun: value })} />
        <div className="md:col-span-5">
          <Button type="button" variant="outline" disabled={busy === "settings"} onClick={() => void run({ action: "settings", settings: form }, "Curator settings saved.")}>
            <Save className="size-4" />
            Save settings
          </Button>
        </div>
      </div>
      <CuratorTable skills={skills} busy={busy} onAction={(input, success) => void run(input, success)} />
    </DashboardSection>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" min={1} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex min-h-[66px] items-center justify-between gap-3 rounded-md border px-3 py-2">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function CuratorTable({
  skills,
  busy,
  onAction,
}: {
  skills: CuratedSkillStatus[]
  busy: string | null
  onAction: (input: Parameters<typeof dashboardApi.curatorAction>[0], success: string) => void
}) {
  if (skills.length === 0) {
    return <EmptyPanel title="No curated skills" description="agent-created skill이 아직 없습니다." />
  }

  return (
    <DataTableShell>
      <thead>
        <tr>
          <th>Skill</th>
          <th>Status</th>
          <th>Idle</th>
          <th>Usage</th>
          <th>Last used</th>
          <th>Manage</th>
        </tr>
      </thead>
      <tbody>
        {skills.map((skill) => (
          <tr key={`${skill.state}:${skill.name}`}>
            <td>
              <div className="max-w-[280px]">
                <p className="truncate font-medium">{skill.name}</p>
                <p className="truncate text-xs text-muted-foreground">{skill.location}</p>
              </div>
            </td>
            <td><StatusBadge tone={curatorTone(skill.state)}>{skill.state}</StatusBadge></td>
            <td>{skill.idleDays === undefined ? "-" : `${skill.idleDays}d`}</td>
            <td>use {formatInteger(skill.useCount)} · view {formatInteger(skill.viewCount)} · patch {formatInteger(skill.patchCount)}</td>
            <td className="whitespace-nowrap">{formatDateTime(skill.lastUsedAt ?? skill.updatedAt ?? skill.createdAt)}</td>
            <td>
              <div className="flex flex-wrap gap-2">
                {skill.state === "archived" ? (
                  <Button type="button" size="sm" variant="outline" disabled={busy === "restore"} onClick={() => onAction({ action: "restore", name: skill.name }, `Restored ${skill.name}`)}>
                    <RotateCcw className="size-4" />
                    Restore
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy === (skill.pinned ? "unpin" : "pin")}
                      onClick={() => onAction({ action: skill.pinned ? "unpin" : "pin", name: skill.name }, `${skill.pinned ? "Unpinned" : "Pinned"} ${skill.name}`)}
                    >
                      <Pin className="size-4" />
                      {skill.pinned ? "Unpin" : "Pin"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy === "archive"} onClick={() => onAction({ action: "archive", name: skill.name }, `Archived ${skill.name}`)}>
                      <Archive className="size-4" />
                      Archive
                    </Button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  )
}

function curatorTone(state: CuratedSkillStatus["state"]): StatusTone {
  if (state === "active" || state === "pinned") return "success"
  if (state === "stale") return "warning"
  return "neutral"
}
