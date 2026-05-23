# @pie-lab/router

Router package for model selection, fallback, account selection, quota policy, and routing attempts.

In 9router-derived routing language, "account" means a provider credential connection, not a pie-lab user signup account.
Prefer `provider connection` and `connectionId` in new pie-lab code and docs.

Source direction:

- Routing, fallback, account, quota, and RTK ideas come from `https://github.com/jikime/9router`.
- Actual provider calls should use the existing pi provider/runtime stack.
- Usage records must be stored through `@pie-lab/storage`.

Current implemented scope:

- Parse `fixed:...`, `fallback:...`, `auto:...`, `cheap:...`, `fast:...`, `combo:...`
- Resolve `provider/model` strings into `resolvedProvider` and `resolvedModel`
- Resolve pi `Model` objects through a `PiModelCatalog`
- Build ordered route plans through `resolvePiModelRoutePlan()`
- Expand `combo:*` aliases and structured `primary + fallback[]` selections into route candidates
- Build default top-candidate route plans for `combo:*` aliases when no policy is supplied
- Expand 9router-style named combos from policy data, e.g. `premium-coding`
- Apply 9router-style combo strategy: `fallback` or `round-robin`
- Apply 9router-style sticky round-robin limits for combos
- Provide account fallback/cooldown helpers ported from 9router:
  - `checkFallbackError()`
  - `getQuotaCooldown()`
  - `filterAvailableAccounts()`
  - `isModelLockActive()`
  - model lock helpers such as `modelLock_${model}`
  - provider reset-time cooldown extraction through `extractProviderResetCooldownMs()`
- Provide account selection helper based on 9router `getProviderCredentials()`:
  - `selectProviderConnection()`
  - `fill-first`
  - `round-robin`
  - `quota-aware`
  - sticky round-robin updates
  - `preferredConnectionId`
  - model-locked account exclusion
- Quota-aware selection reads `providerSpecificData.pieLabQuotaSelection` snapshots produced by 9router-derived quota fetchers.
- Server and coding-agent execution paths use `checkFallbackError()` before trying the next route attempt
- Server and coding-agent execution paths persist failed connection cooldowns as `modelLock_${model}`
- Provider-reported reset timing such as Codex `usage_limit_reached.resets_at`, `resets_in_seconds`, `Retry-After`, and Antigravity-style `reset after 1h30m` messages can override exponential cooldown, capped like 9router.
- Server exposes model availability/cooldown state and the 9router-style `clearCooldown` action.
- Provide virtual router model ids through `PIE_LAB_ROUTER_MODEL_IDS`

Still pending:

- RTK token saver integration
