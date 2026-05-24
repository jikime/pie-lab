"use client"

import { useCallback, useMemo, useState } from "react"
import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { dashboardApi, type MediaKind, type MediaRoutesResponse, type MediaTestResponse } from "@/lib/api-client"
import { compactJson, safeErrorMessage } from "@/lib/format"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge, healthTone } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

const kindLabels: Record<MediaKind, string> = {
  embedding: "Embeddings",
  webSearch: "Web search",
  webFetch: "Web fetch",
  tts: "TTS",
  stt: "STT",
  image: "Image",
}

const mediaKinds: MediaKind[] = ["embedding", "webSearch", "webFetch", "tts", "stt", "image"]

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
        description="Embeddings, image, TTS/STT, web search/fetch 라우팅 후보와 endpoint 호출을 확인합니다."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      {loading ? <LoadingPanel /> : null}
      {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : null}

      <MediaTestPanel />

      {data ? (
        <>
          {grouped.map(([kind, routes]) => (
            <DashboardSection key={kind} title={kindLabels[kind as MediaKind] ?? kind} description={`Alias: auto:${kind}`}>
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

function MediaTestPanel() {
  const [kind, setKind] = useState<MediaKind>("webSearch")
  const [payload, setPayload] = useState(compactJson(defaultPayload("webSearch")))
  const [file, setFile] = useState<File | undefined>()
  const [result, setResult] = useState<MediaTestResponse | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function changeKind(nextKind: MediaKind) {
    setKind(nextKind)
    setPayload(compactJson(defaultPayload(nextKind)))
    setFile(undefined)
    setResult(null)
    setMessage(null)
  }

  async function runTest() {
    setBusy(true)
    setMessage(null)
    setResult(null)
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      if (kind === "stt" && !file) {
        throw new Error("STT 테스트에는 audio file이 필요합니다.")
      }
      const response = await dashboardApi.testMediaEndpoint(kind, parsed, file)
      setResult(response)
    } catch (testError) {
      setMessage(safeErrorMessage(testError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardSection
      title="Endpoint test"
      description="실제 provider credential과 budget 정책을 사용해 media endpoint를 호출합니다. 테스트 결과도 usage/cost 기록에 반영됩니다."
      actions={
        <Button type="button" onClick={() => void runTest()} disabled={busy}>
          <Play className="size-4" />
          Run
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(value) => changeKind(value as MediaKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mediaKinds.map((item) => (
                  <SelectItem key={item} value={item}>
                    {kindLabels[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind === "stt" ? (
            <div className="space-y-2">
              <Label>Audio file</Label>
              <Input type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0])} />
            </div>
          ) : null}
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            endpoint: <span className="font-mono">{endpointLabel(kind)}</span>
          </div>
        </div>
        <div className="space-y-3">
          <Textarea value={payload} onChange={(event) => setPayload(event.target.value)} className="min-h-[220px] font-mono text-xs" />
          {message ? <p className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
          {result ? <MediaTestResult result={result} /> : null}
        </div>
      </div>
    </DashboardSection>
  )
}

function MediaTestResult({ result }: { result: MediaTestResponse }) {
  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
        <StatusBadge tone={result.ok ? "success" : healthTone("error")}>{result.status}</StatusBadge>
        <span className="text-xs text-muted-foreground">{result.contentType || result.statusText}</span>
      </div>
      <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words p-3 text-xs">{truncate(result.bodyText, 6000)}</pre>
    </div>
  )
}

function defaultPayload(kind: MediaKind): Record<string, unknown> {
  switch (kind) {
    case "embedding":
      return { model: "auto:embedding", input: "Pie Lab routing test" }
    case "webSearch":
      return { provider: "auto:webSearch", query: "Pie Lab agentic development kit", max_results: 3 }
    case "webFetch":
      return { provider: "auto:webFetch", url: "https://example.com", format: "markdown", max_characters: 1200 }
    case "tts":
      return { model: "auto:tts", input: "안녕하세요. Pie Lab media routing test입니다." }
    case "stt":
      return { model: "auto:stt", language: "ko", prompt: "Transcribe this audio." }
    case "image":
      return { model: "auto:image", prompt: "A friendly Pie Lab terminal mascot, clean product icon", size: "1024x1024" }
  }
}

function endpointLabel(kind: MediaKind): string {
  switch (kind) {
    case "embedding":
      return "/v1/embeddings"
    case "webSearch":
      return "/v1/search"
    case "webFetch":
      return "/v1/web/fetch"
    case "tts":
      return "/v1/audio/speech"
    case "stt":
      return "/v1/audio/transcriptions"
    case "image":
      return "/v1/images/generations"
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}
