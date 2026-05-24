"use client"

import { useCallback, useEffect, useState } from "react"
import { LogIn, Plus, Power, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { dashboardApi, type OAuthProvidersResponse, type ProviderConnectionsResponse, type ProviderStatusResponse } from "@/lib/api-client"
import { formatDateTime, safeErrorMessage } from "@/lib/format"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { DashboardSection } from "../dashboard-section"
import { PageHeader } from "../page-header"
import { StatusBadge, healthTone } from "../status-badge"
import { useApiResource } from "../use-api-resource"
import { DataTableShell } from "./shared"

interface ProvidersData {
  providers: ProviderStatusResponse
  connections: ProviderConnectionsResponse
  oauth: OAuthProvidersResponse
}

const OAUTH_FLOW_STORAGE_KEY = "pie-lab.dashboard.oauthFlow"

export function ProvidersPage() {
  const loader = useCallback(async (): Promise<ProvidersData> => {
    const [providers, connections, oauth] = await Promise.all([
      dashboardApi.providers(),
      dashboardApi.providerConnections(),
      dashboardApi.oauthProviders(),
    ])
    return { providers, connections, oauth }
  }, [])
  const { data, error, loading, refresh } = useApiResource(loader)
  const [message, setMessage] = useState<string | null>(null)
  const [provider, setProvider] = useState("")
  const [name, setName] = useState("")
  const [authType, setAuthType] = useState("apikey")
  const [apiKey, setApiKey] = useState("")
  const [accessToken, setAccessToken] = useState("")
  const [priority, setPriority] = useState("")
  const [oauthProvider, setOauthProvider] = useState("codex")
  const [oauthEmail, setOauthEmail] = useState("")
  const [oauthProjectId, setOauthProjectId] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let ignored = false

    async function completeOAuthRedirectFromUrl() {
      await Promise.resolve()
      const params = new URLSearchParams(window.location.search)
      const code = params.get("code")
      const state = params.get("state") ?? ""
      const callbackError = params.get("error")

      if (callbackError) {
        clearOAuthQueryParams()
        if (!ignored) setMessage(`OAuth callback failed: ${callbackError}`)
        return
      }
      if (!code) return

      try {
        const flow = readStoredOAuthFlow()
        const provider = flow?.provider ?? oauthProvider
        const codeVerifier = flow?.codeVerifier
        const redirectUri = flow?.redirectUri ?? defaultOAuthRedirectUri()
        const expectedState = flow?.state ?? ""
        if (expectedState && state && expectedState !== state) {
          throw new Error("OAuth state가 일치하지 않습니다.")
        }
        if (!codeVerifier) {
          throw new Error("code verifier가 없습니다. OAuth 로그인을 다시 시작해 주세요.")
        }

        const result = await dashboardApi.completeOAuthCallback({
          provider,
          code,
          state,
          codeVerifier,
          redirectUri,
          email: flow?.email,
          projectId: flow?.projectId,
        })

        localStorage.removeItem(OAUTH_FLOW_STORAGE_KEY)
        clearOAuthQueryParams()
        if (!ignored) {
          setMessage(`OAuth connection saved: ${result.connection.provider}/${result.connection.id}`)
          await refresh()
        }
      } catch (callbackError) {
        clearOAuthQueryParams()
        if (!ignored) setMessage(safeErrorMessage(callbackError))
      }
    }

    void completeOAuthRedirectFromUrl()

    return () => {
      ignored = true
    }
  }, [oauthProvider, refresh])

  async function createConnection() {
    setBusy(true)
    setMessage(null)
    try {
      await dashboardApi.createProviderConnection({
        provider,
        name,
        authType,
        apiKey: authType === "apikey" ? apiKey : undefined,
        accessToken: authType !== "apikey" ? accessToken : undefined,
        priority: priority.trim() ? Number(priority) : undefined,
      })
      setProvider("")
      setName("")
      setApiKey("")
      setAccessToken("")
      setPriority("")
      setMessage("Provider connection created.")
      await refresh()
    } catch (createError) {
      setMessage(safeErrorMessage(createError))
    } finally {
      setBusy(false)
    }
  }

  async function toggleConnection(id: string, isActive: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      await dashboardApi.updateProviderConnection(id, { isActive })
      setMessage(isActive ? "Provider connection enabled." : "Provider connection disabled.")
      await refresh()
    } catch (toggleError) {
      setMessage(safeErrorMessage(toggleError))
    } finally {
      setBusy(false)
    }
  }

  async function deleteConnection(id: string) {
    setBusy(true)
    setMessage(null)
    try {
      await dashboardApi.deleteProviderConnection(id)
      setMessage("Provider connection removed.")
      await refresh()
    } catch (deleteError) {
      setMessage(safeErrorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  async function startOAuthRedirectLogin() {
    setBusy(true)
    setMessage(null)
    try {
      const redirectUri = defaultOAuthRedirectUri()
      const flow = await dashboardApi.startOAuthLogin(oauthProvider, redirectUri)
      localStorage.setItem(
        OAUTH_FLOW_STORAGE_KEY,
        JSON.stringify({
          provider: flow.provider,
          state: flow.state,
          codeVerifier: flow.codeVerifier,
          redirectUri: flow.redirectUri,
          email: oauthEmail,
          projectId: oauthProjectId,
        }),
      )
      window.location.assign(flow.authorizationUrl)
    } catch (oauthError) {
      setMessage(safeErrorMessage(oauthError))
      setBusy(false)
    }
  }

  const credentialReady = authType === "apikey" ? apiKey.trim().length > 0 : accessToken.trim().length > 0

  return (
    <>
      <PageHeader
        title="Providers"
        description="LLM provider 연결, 인증 상태, 모델 가용성을 한 화면에서 확인합니다."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      {loading ? <LoadingPanel /> : null}
      {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : null}

      <DashboardSection title="Add connection" description="Manual API key, access token, OAuth token을 직접 저장합니다. 브라우저 redirect 인증은 아래 login 영역을 사용합니다.">
        <div className="grid gap-3 lg:grid-cols-[140px_1fr_140px_1.5fr_100px_auto]">
          <Input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Provider" />
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name or email" />
          <Select value={authType} onValueChange={setAuthType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apikey">API key</SelectItem>
              <SelectItem value="access_token">Access token</SelectItem>
              <SelectItem value="oauth">OAuth token</SelectItem>
            </SelectContent>
          </Select>
          {authType === "apikey" ? (
            <Input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API key" type="password" />
          ) : (
            <Input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Access token" type="password" />
          )}
          <Input value={priority} onChange={(event) => setPriority(event.target.value)} placeholder="Priority" type="number" />
          <Button type="button" onClick={() => void createConnection()} disabled={busy || !provider || !credentialReady}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        {message ? <p className="mt-3 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      </DashboardSection>

      {data ? (
        <>
          <DashboardSection title="OAuth redirect login" description="Claude, Codex, Gemini CLI 계정은 브라우저 redirect flow로 연결합니다.">
            <div className="grid gap-3 lg:grid-cols-[180px_1fr_1fr_auto]">
              <Select value={oauthProvider} onValueChange={setOauthProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.oauth.providers.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={oauthEmail} onChange={(event) => setOauthEmail(event.target.value)} placeholder="Email label" type="email" />
              <Input value={oauthProjectId} onChange={(event) => setOauthProjectId(event.target.value)} placeholder="Project ID for Gemini" />
              <Button type="button" onClick={() => void startOAuthRedirectLogin()} disabled={busy || !oauthProvider}>
                <LogIn className="size-4" />
                Login
              </Button>
            </div>
          </DashboardSection>

          <DashboardSection title="Provider setup guide" description="Provider별로 어떤 인증 방식을 우선 사용할지 빠르게 확인합니다.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {providerGuideItems.map((item) => (
                <div key={item.provider} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{item.provider}</p>
                    <StatusBadge tone={item.tone}>{item.auth}</StatusBadge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </DashboardSection>

          <DashboardSection title="Provider catalog">
            <DataTableShell>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Health</th>
                  <th>Models</th>
                  <th>Quota</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.data.map((provider) => (
                  <tr key={provider.id}>
                    <td className="font-medium">{provider.name}</td>
                    <td>
                      <StatusBadge tone={healthTone(provider.health)}>{provider.health}</StatusBadge>
                    </td>
                    <td>{provider.availableModels}/{provider.models}</td>
                    <td>{provider.quotaAvailableCount}/{provider.quotaAvailableCount + provider.quotaDepletedCount}</td>
                    <td className="max-w-md truncate text-muted-foreground">{provider.healthReason}</td>
                  </tr>
                ))}
              </tbody>
            </DataTableShell>
          </DashboardSection>

          <DashboardSection title="Connections">
            <DataTableShell>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Name</th>
                  <th>Auth</th>
                  <th>Status</th>
                  <th>Last used</th>
                  <th>Error</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.connections.map((connection) => (
                  <tr key={connection.id}>
                    <td className="font-medium">{connection.provider}</td>
                    <td>{connection.displayName ?? connection.name ?? connection.email ?? connection.id}</td>
                    <td>{connection.authType}</td>
                    <td>
                      <StatusBadge tone={connection.isActive ? "success" : "neutral"}>
                        {connection.isActive ? "active" : "inactive"}
                      </StatusBadge>
                    </td>
                    <td>{formatDateTime(connection.lastUsedAt)}</td>
                    <td className="max-w-md truncate text-muted-foreground">{String(connection.lastError ?? "-")}</td>
                    <td>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void toggleConnection(connection.id, !connection.isActive)}
                        >
                          <Power className="size-4" />
                          {connection.isActive ? "Disable" : "Enable"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void deleteConnection(connection.id)}>
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
        </>
      ) : null}
    </>
  )
}

const providerGuideItems: Array<{
  provider: string
  auth: string
  tone: "success" | "info" | "warning" | "neutral"
  description: string
}> = [
  {
    provider: "Codex",
    auth: "OAuth",
    tone: "success",
    description: "OpenAI 계정 기반 CLI 토큰을 redirect flow로 저장한 뒤 auto:coding 라우팅 후보로 사용합니다.",
  },
  {
    provider: "Claude",
    auth: "OAuth/API key",
    tone: "warning",
    description: "구독 계정의 third-party 제한이 있을 수 있으므로 API key나 다른 provider fallback을 함께 두는 편이 안전합니다.",
  },
  {
    provider: "Gemini",
    auth: "OAuth/API key",
    tone: "success",
    description: "OAuth 연결에는 projectId 라벨을 함께 남기고, 기본 후보는 Gemini 2.5 이상 모델로 맞춥니다.",
  },
  {
    provider: "OpenRouter",
    auth: "API key",
    tone: "info",
    description: "여러 모델을 한 provider로 묶어 실험할 때 편합니다. 비용 추적은 OpenRouter 응답과 catalog 정보를 기준으로 남깁니다.",
  },
  {
    provider: "Media providers",
    auth: "API key",
    tone: "neutral",
    description: "Embeddings, image, TTS/STT, web search/fetch는 Media 페이지에서 endpoint별로 따로 테스트합니다.",
  },
]

function defaultOAuthRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`
}

function clearOAuthQueryParams(): void {
  window.history.replaceState({}, document.title, defaultOAuthRedirectUri())
}

function readStoredOAuthFlow(): {
  provider: string
  state: string
  codeVerifier: string
  redirectUri: string
  email?: string
  projectId?: string
} | null {
  try {
    const raw = localStorage.getItem(OAUTH_FLOW_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.provider !== "string" || typeof parsed.codeVerifier !== "string") return null
    return {
      provider: parsed.provider,
      state: typeof parsed.state === "string" ? parsed.state : "",
      codeVerifier: parsed.codeVerifier,
      redirectUri: typeof parsed.redirectUri === "string" ? parsed.redirectUri : defaultOAuthRedirectUri(),
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
    }
  } catch {
    return null
  }
}
