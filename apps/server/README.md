# @pie-lab/server

Local API server for pie-lab.

Initial responsibility:

- Preserve existing pi workflows.
- Expose OpenAI-compatible endpoints such as `/v1/chat/completions`.
- Expose ADK-native endpoints later.
- Route all model calls through `@pie-lab/router`.
- Persist usage and request details through `@pie-lab/storage`.

Current endpoints:

- `GET /health`
- `GET /models`
- `GET /v1/models`
- `GET /models/availability`
- `GET /v1/models/availability`
- `POST /models/availability`
- `POST /v1/models/availability`
- `GET /providers`
- `GET /v1/providers`
- `GET /quota`
- `GET /v1/quota`
- `GET /quota/:connectionId`
- `GET /v1/quota/:connectionId`
- `GET /budget`
- `GET /v1/budget`
- `GET /oauth/providers`
- `GET /oauth/start`
- `POST /oauth/callback`
- `GET /proxy-pools`
- `GET /v1/proxy-pools`
- `POST /proxy-pools`
- `GET /proxy-pools/:proxyPoolId`
- `PUT /proxy-pools/:proxyPoolId`
- `DELETE /proxy-pools/:proxyPoolId`
- `POST /proxy-pools/:proxyPoolId/test`
- `POST /v1/proxy-pools/:proxyPoolId/test`
- `PUT /provider-connections/:connectionId`
- `GET /usage`
- `GET /v1/usage`
- `GET /usage/summary`
- `GET /v1/usage/summary`
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `POST /v1/search`
- `POST /v1/web/fetch`
- `POST /v1/audio/speech`
- `POST /v1/audio/transcriptions`
- `POST /v1/images/generations`

`POST /v1/chat/completions` supports non-stream responses and `stream: true` SSE responses.
Streaming fallback only happens before the first SSE chunk is sent.

Usage file resolution:

1. `PIE_LAB_USAGE_PATH`
2. `PI_CODING_AGENT_DIR/usage.jsonl`
3. `~/.pie/agent/usage.jsonl`

Model/auth resolution:

1. `PI_CODING_AGENT_DIR/models.json`
2. `PI_CODING_AGENT_DIR/auth.json`
3. `~/.pie/agent/models.json`
4. `~/.pie/agent/auth.json`

Provider API keys and custom headers are resolved through the coding-agent `ModelRegistry` and `AuthStorage`.
Stored `auth.json` credentials are mirrored into `provider-connections.json` as `source=auth.json` connections.
When stored credentials change, the mirrored connection is updated; when credentials are removed, only the mirrored connection is deactivated and its token/key fields are cleared.

Provider quota resolution:

- Quota is connection-based, following 9router's usage/quota shape.
- `/quota` lists provider connections and whether they are supported/eligible for quota lookup.
- `/quota/:connectionId` fetches quota detail for a specific provider connection.
- Current fetchers include GitHub, Claude, Codex, Gemini CLI, Antigravity, Kiro, GLM, MiniMax, and Ollama informational status.
- `/usage` remains pie-lab's local request usage record API, so provider quota is exposed under `/quota`.
- API keys and access tokens are not exposed in quota list/detail responses.
- OAuth token refresh runs before quota detail lookup for supported OAuth connections and stores refreshed tokens back to provider connections.
- Proxy-aware quota fetch supports connection legacy proxy fields, Vercel relay URL, env proxy variables, and 9router-style MITM DNS bypass.
- Proxy-aware quota fetch also resolves `providerSpecificData.proxyPoolId` through the storage proxy pool store.
- Proxy pool priority follows 9router: active proxy pool, then legacy connection proxy, then no proxy.
- Quota/refresh calls force `strictProxy: false` like 9router usage routes, so proxy failures can fall back to direct calls.
- Quota detail fetch stores a `providerSpecificData.pieLabQuotaSelection` snapshot for account selection.
- Default server routing refreshes stale quota snapshots before provider connection selection through `@pie-lab/shared`.
- The same shared quota preparer is also used by default coding-agent session creation, so server and internal execution share account scoring behavior.
- The default account policy is quota-aware: depleted fresh snapshots are excluded, and higher remaining quota is preferred.
- During chat completion routing, provider quota/rate-limit errors lock the selected provider connection through `modelLock_${model}`.
- Provider reset timing such as `resets_at`, `resets_in_seconds`, `Retry-After`, or `reset after 1h30m` overrides exponential cooldown and is capped at 30 minutes.

Budget and OAuth:

- `/budget` reports global or provider-scoped budget usage from recorded request costs.
- `provider-settings.budgetLimits.mode = "block"` blocks chat/media requests before upstream calls and records skipped attempts.
- `/oauth/start` and `/oauth/callback` implement the dashboard browser redirect flow for Claude, Codex, and Gemini CLI.
- Manual OAuth token import remains available through `/provider-connections`.

Model availability:

- `/models/availability` exposes current active `modelLock_${model}` cooldowns from `provider-connections.json`.
- The response groups active locks by provider connection and model, including retry-after text and unlock time.
- `POST /models/availability` supports the 9router-style `{ "action": "clearCooldown", "provider": "...", "model": "..." }` body.
- `clearCooldown` clears `modelLock_${model}` for matching provider connections and resets unavailable error metadata.
- API keys and access tokens are not exposed.
- This endpoint does not call provider quota APIs. It reports the same persisted lock state that routing uses to exclude unavailable connections.

Proxy pool management:

- `/proxy-pools?includeUsage=true` returns proxy pools with `boundConnectionCount`.
- `POST /proxy-pools` creates a 9router-style proxy pool.
- `PUT /proxy-pools/:proxyPoolId` updates name, URL, type, active state, strict proxy, and test metadata.
- `DELETE /proxy-pools/:proxyPoolId` refuses to delete a pool that is still bound to provider connections.
- `POST /proxy-pools/:proxyPoolId/test` tests a pool like 9router: HTTP pools use `undici.ProxyAgent`, Vercel relay pools use relay target headers.
- Proxy pool tests update `testStatus`, `lastTestedAt`, `lastError`, and `isActive`.
- `PUT /provider-connections/:connectionId` with `{ "proxyPoolId": "..." }` assigns a pool.
- `proxyPoolId: null`, empty string, or `"__none__"` clears the assignment.

Run locally:

```bash
npm --workspace @pie-lab/ai run build
npm --workspace @pie-lab/shared run build
npm --workspace @pie-lab/server run dev
```

Example:

```bash
curl http://127.0.0.1:4873/v1/models

curl http://127.0.0.1:4873/models/availability

curl -X POST http://127.0.0.1:4873/models/availability \
  -H "content-type: application/json" \
  -d '{ "action": "clearCooldown", "provider": "codex", "model": "gpt-5.4" }'

curl http://127.0.0.1:4873/quota

curl http://127.0.0.1:4873/quota/<connectionId>

curl -X POST http://127.0.0.1:4873/proxy-pools/<proxyPoolId>/test

curl http://127.0.0.1:4873/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "auto:coding",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'

curl -N http://127.0.0.1:4873/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "auto:coding",
    "stream": true,
    "messages": [{ "role": "user", "content": "Hello" }]
  }'
```
