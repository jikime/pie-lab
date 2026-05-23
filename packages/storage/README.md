# @pie-lab/storage

Storage package for provider accounts, settings, usage history, request details, and later chat channel state.

In 9router-derived routing language, a provider "account" is a provider credential connection such as an API key or OAuth token.
It is separate from dashboard login or user signup.

Source direction:

- Usage/request logging and pricing override ideas come from `https://github.com/jikime/9router`.
- Chat account/channel state will be informed by `https://github.com/jikime/pi-chat`.
- Existing pi session/runtime persistence should be preserved where possible.

Current implemented scope:

- `UsageRecord` shape for resolved model attempts
- `UsageStore` interface
- `InMemoryUsageStore` for tests and embedded use
- `JsonlUsageStore` for local append-only usage history
- `queryUsageRecords()` for filtering recent usage records
- `summarizeUsageRecords()` for token/cost/status aggregates
- `ProviderConnection` shape based on 9router provider connections
- `ProviderConnectionStore` interface
- `InMemoryProviderConnectionStore` for tests and embedded use
- `JsonProviderConnectionStore` for local provider connection/settings state
- `ProxyPool` shape based on 9router proxy pools
- Proxy pool methods on `ProviderConnectionStore`:
  - `getProxyPools()`
  - `getProxyPoolById()`
  - `createProxyPool()`
  - `updateProxyPool()`
  - `deleteProxyPool()`
- 9router-style account routing settings:
  - `fallbackStrategy`
  - `stickyRoundRobinLimit`
  - `providerStrategies`

Current first integration:

- `coding-agent` SDK routed stream attempts record success, error, and aborted states.
- Default SDK usage history is written to `agentDir/usage.jsonl`.
- `apps/server` reads this store for `/usage` and `/usage/summary`.
- `ModelRegistry.getApiKeyAndHeaders()` can select credentials from `agentDir/provider-connections.json`.
- If no provider connection exists for a provider, stored `auth.json` credentials can be imported on demand.
- Routed usage records can store the selected `connectionId`.
- Provider failures can persist `modelLock_${model}`, error metadata, and backoff state on the selected connection.
- Provider success clears the current model lock and expired locks for the selected connection.
- `provider-connections.json` can now store 9router-style `proxyPools` beside `connections` and `settings`.
- Quota API can resolve `providerSpecificData.proxyPoolId` through this proxy pool store.
- `apps/server` and `apps/dashboard` can create proxy pools and assign them to provider connections.

Still pending:

- Syncing provider connection removal when credentials are removed from `auth.json`
- Dashboard and CLI screens for provider connection setup
- Proxy pool test endpoint and Vercel relay deploy helper
- Quota storage
- Pricing override storage
- Migration from JSONL to a richer local database if needed
