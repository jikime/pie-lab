# @pie-lab/dashboard

Dashboard app for provider setup, routing policy, usage/cost visibility, request logs, and later chat bridge status.

Source direction:

- Base UI/UX ideas come from `https://github.com/jikime/9router`.
- Provider calls must go through the pie-lab router/provider flow.
- Usage and cost views should read from `@pie-lab/storage`.

Current implemented scope:

- Vite-based local dashboard shell.
- Usage summary cards.
- Provider/auth status table.
- Proxy pool creation/list/toggle/delete controls.
- Provider quota connection status table.
- Model cooldown availability table.
- Model cooldown clear button.
- Provider connection proxy pool assignment controls.
- On-demand provider quota detail panel.
- Provider/model aggregate lists.
- Recent usage record table.
- Filters for status, provider, model, limit, and order.
- Budget policy form and budget usage/exhaustion status panel.
- Manual API key/access token/OAuth token import.
- Browser redirect OAuth login for Claude, Codex, and Gemini CLI.
- Reads `GET /providers`, `GET /models/availability`, `GET /proxy-pools`, `GET /quota`, `GET /budget`, `GET /usage`, and `GET /usage/summary` from `@pie-lab/server`.
- Writes `POST /oauth/callback`, `POST /models/availability`, `POST /proxy-pools`, `PUT /proxy-pools/:proxyPoolId`, `DELETE /proxy-pools/:proxyPoolId`, and `PUT /provider-connections/:connectionId`.

Quota scope:

- The dashboard currently shows whether each provider connection can be queried for quota.
- It calls `/quota/:connectionId` only when a user selects a specific connection.
- It does not automatically call every quota detail endpoint, because those calls may hit real provider APIs.
- It can bind a provider connection to a proxy pool, and quota detail lookup will use that pool through the server.
- Server routing can use quota snapshots for quota-aware account selection.

Model availability scope:

- The dashboard shows active `modelLock_${model}` cooldowns stored on provider connections.
- It displays the locked connection, provider, model scope, retry-after text, unlock time, and last error.
- The clear button sends the 9router-style `{ "action": "clearCooldown", "provider": "...", "model": "..." }` request.
- This view does not call provider quota detail endpoints automatically.

Run locally:

```bash
npm --workspace @pie-lab/server run dev
npm --workspace @pie-lab/dashboard run dev
```

Default URLs:

```txt
server     http://127.0.0.1:4873
dashboard  http://127.0.0.1:4874
```
