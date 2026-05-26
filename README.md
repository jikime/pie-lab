<p align="center">
  <a href="https://pielab.ai">
    <img alt="pie-lab logo" src="https://pielab.ai/logo-auto.svg" width="128">
  </a>
</p>

<p align="center">
  <strong>pie-lab</strong><br>
  A local-first agent lab that starts from <code>pi</code>, adds 9router operations,
  ports Hermes-style learning, and connects agents to web chat, Telegram, and Discord.
</p>

<p align="center">
  <a href="https://pielab.ai">pielab.ai</a>
  ·
  <a href="https://jikime.github.io/pie-lab/install.sh">install.sh</a>
  ·
  <a href="./docs/README.md">docs</a>
  ·
  <a href="./docs/chat-usage.md">chat guide</a>
  ·
  <a href="./docs/learning-loop.md">learning loop</a>
</p>

---

# pie-lab

`pie-lab` is a practical fork-and-integration project for building a personalized Agentic Development Kit.

It starts from the full [`pi`](https://github.com/earendil-works/pi) coding-agent source tree, then brings in the most useful operational ideas from [`9router`](https://github.com/decolua/9router), the chat bridge experience from [`pi-chat`](https://github.com/earendil-works/pi-chat), and the learning-loop pattern from [`hermes-agent`](https://github.com/NousResearch/hermes-agent).

The operations dashboard inspired by `9router` and the chat experience inspired by `pi-chat` have both been rebuilt as Next.js apps inside this repository, so they can work directly with pie-lab's local server, router, provider settings, and agent bridge.

The result is a single local-first workspace where the CLI agent, model router, provider/account operations, dashboard, persistent memory, automatic skills, and external chat bridges are meant to work together.

<p align="center">
  <img alt="Pio, pie-lab AI Ant Companion" src="docs/assets/pio.png" width="520">
</p>
<p align="center">
  <strong>Pio</strong> is pie-lab's AI Ant Companion.
</p>

## What This Project Combines

| Source | Role in pie-lab |
|--------|------------------|
| [`earendil-works/pi`](https://github.com/earendil-works/pi) | Base CLI, TUI, agent runtime, tools, extensions, skills, sessions |
| [`decolua/9router`](https://github.com/decolua/9router) | Router aliases, fallback, provider connections, quota, cooldown, usage/cost accounting, and the operations model rebuilt here as a Next.js dashboard |
| [`earendil-works/pi-chat`](https://github.com/earendil-works/pi-chat) | Web chat direction plus Telegram/Discord bridge workflows rebuilt here as a Next.js chat app |
| [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) | Learning loop ideas: persistent memory, automatic skill creation, skill curation, user modeling |

Imported baseline details are tracked in [docs/origins.md](./docs/origins.md).

## Current Capabilities

- `pie` coding-agent CLI based on the original `pi` workflow.
- Local OpenAI-compatible API server at `apps/server`.
- Next.js dashboard at `apps/dashboard` for usage, cost, providers, quota, routing policy, proxy, media tests, logs, and Learning Loop operations.
- Pie Chat web UI at `apps/chat`.
- Telegram/Discord bridge extension with `/chat-config`, `/chat-connect`, `/chat-spawn-all`, and `/chat-workers`.
- 9router-style model routing with aliases such as `auto:coding`, `auto:chat`, `auto:learning`, and `auto:memory`.
- Provider connection storage, account selection, fallback attempts, quota-aware routing, cooldown/model lock handling, and usage/cost records.
- Claude Code local provider path through `claude-code-adk`.
- Hermes-style Learning Loop:
  - local memory in `~/.pie/agent/memories`
  - global agent skills in `~/.pie/agent/skills`
  - project skills in `.pie/skills`
  - background review and proposal records
  - skill curator archive/restore support
  - optional Honcho user modeling

## Repository Layout

| Path | Purpose |
|------|---------|
| [packages/coding-agent](./packages/coding-agent) | `pie` CLI, TUI, sessions, extensions, skills, Learning Loop runtime |
| [packages/agent](./packages/agent) | Agent runtime and tool-calling core |
| [packages/ai](./packages/ai) | Provider abstraction and model adapters |
| [packages/router](./packages/router) | 9router-derived routing, fallback, quota and policy logic |
| [packages/storage](./packages/storage) | JSON stores for provider connections, usage, quota, and policy state |
| [apps/server](./apps/server) | Local OpenAI-compatible API and operations API |
| [apps/dashboard](./apps/dashboard) | Next.js operations dashboard |
| [apps/chat](./apps/chat) | Pie Chat web UI and Telegram/Discord bridge extension |
| [.pie/settings.json](./.pie/settings.json) | Project-local package settings, including the chat bridge extension |

## Requirements

- Node.js `>=22.19.0` is required. Older Node 22 builds such as `22.12.0` can fail during `npm run build`.
- npm
- Git
- `tmux` if you want long-running Telegram/Discord bridge workers
- At least one model provider credential or local provider path

The repository includes `.node-version`, so with `nvm`:

```bash
nvm install
nvm use
node -v
```

Make sure `node -v` prints `v22.19.0` or newer before running `npm install` or `npm run build`.

## Install The CLI

The default user install is the npm package, bootstrapped by the GitHub Pages installer:

```bash
curl -fsSL https://jikime.github.io/pie-lab/install.sh | sh
pie
```

The installer checks for Node.js `>=22.19.0`, checks for npm, then installs:

```bash
npm install -g --ignore-scripts @pie-lab/coding-agent
```

For inspection-first installs, download the script before running it:

```bash
curl -fsSLO https://jikime.github.io/pie-lab/install.sh
sh install.sh
```

## Install From Source

```bash
git clone git@github.com:jikime/pie-lab.git
cd pie-lab
nvm install
nvm use
node -v
npm install
npm run build
```

`npm run build` builds the core packages, server, dashboard, and Pie Chat. The Pie Chat build also type-checks the Telegram/Discord bridge.

For day-to-day local CLI development, run the source CLI directly:

```bash
./pie-test.sh
```

To make the local checkout available as a `pie` command on your `PATH`, build first and then link the workspace package:

```bash
npm run build
npm link --workspace @pie-lab/coding-agent
pie
```

You can also install the published CLI package directly:

```bash
npm install -g --ignore-scripts @pie-lab/coding-agent
pie
```

For this repository, the source checkout is the recommended path because the dashboard, server, chat bridge, and Learning Loop changes live together.

## Provider Setup

You need at least one usable provider before the agent or API server can answer model requests.

Common options:

- Use the CLI `/login` flow inside `pie`.
- Add provider connections from the dashboard `Providers` page.
- Export API keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, or other provider-specific variables supported by `packages/ai`.
- Use `claude-code-adk/*` models when you want the local Claude Code login/subscription path instead of Anthropic API keys.

Provider connection and usage state is stored under:

```txt
~/.pie/agent/
```

CLI and server usage records share `~/.pie/agent/usage.jsonl` by default. Set `PIE_LAB_USAGE_PATH` when you want the dashboard/server to read a different usage file.

## Run The Main Services

You can start the main development stack with:

```bash
npm run dev
```

Before starting, this command clears pie-lab's fixed development ports `4873`, `4876`, and `4877` so stale server, dashboard, or chat processes do not cause `EADDRINUSE` errors. To skip that cleanup, run `npm run dev:start` instead or set `PIE_DEV_SKIP_PORT_CLEANUP=1`.

That starts package watchers plus:

| Service | URL |
|---------|-----|
| API server | `http://127.0.0.1:4873` |
| Dashboard | `http://127.0.0.1:4876` |
| Pie Chat web UI | `http://127.0.0.1:4877` |

You can also run each app separately:

```bash
npm --workspace @pie-lab/server run dev
npm --workspace @pie-lab/dashboard run dev
npm --workspace @pie-lab/pie-chat run dev
```

The dashboard uses `NEXT_PUBLIC_PIE_API_BASE_URL` when you need a different API server:

```bash
NEXT_PUBLIC_PIE_API_BASE_URL=http://127.0.0.1:4873 npm --workspace @pie-lab/dashboard run dev
```

Pie Chat uses the same variable:

```bash
NEXT_PUBLIC_PIE_API_BASE_URL=http://127.0.0.1:4873 npm --workspace @pie-lab/pie-chat run dev
```

## Use The CLI

From the repository:

```bash
./pie-test.sh
```

With a linked or globally installed CLI:

```bash
pie
```

Useful commands inside the TUI:

| Command | Purpose |
|---------|---------|
| `/login` | Add provider credentials |
| `/models` | Select or inspect models |
| `/config` | Edit runtime settings |
| `/reload` | Reload settings, extensions, skills, prompts, and themes |
| `/chat-config` | Configure Telegram/Discord accounts and channels |
| `/chat-connect` | Connect the current `pie` session to a chat channel |
| `/chat-status` | Inspect chat bridge state |

Project settings already register `apps/chat` as a local package, so running `pie` from the repository root loads the chat bridge commands automatically.

## Use The API Server

Start the server:

```bash
npm --workspace @pie-lab/server run dev
```

Example OpenAI-compatible request:

```bash
curl http://127.0.0.1:4873/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "auto:chat",
    "messages": [
      { "role": "user", "content": "Say hello from pie-lab." }
    ]
  }'
```

Useful operational endpoints include:

- `GET /usage`
- `GET /usage/summary`
- `GET /providers`
- `GET /provider-connections`
- `GET /routing-policy`
- `GET /learning`

The dashboard uses the same local API.

## Use The Dashboard

Start:

```bash
npm --workspace @pie-lab/dashboard run dev
```

Open:

```txt
http://127.0.0.1:4876
```

Main pages:

- `Overview`: router and system summary
- `Providers`: provider status, connection CRUD, OAuth/login flows
- `Usage`: request records, origin/endpoint grouping, cost and token totals
- `Quota`: quota snapshots and account availability
- `Routing`: aliases, intents, combo policies, route previews
- `Proxy`: proxy pools and provider connection bindings
- `Media`: embeddings, web fetch/search, audio, image endpoint tests
- `Learning`: memory, background review proposals, and skill curator operations
- `Logs`: recent operational records

## Use Pie Chat

Start the API server first, then the chat app:

```bash
npm --workspace @pie-lab/server run dev
npm --workspace @pie-lab/pie-chat run dev
```

Open:

```txt
http://127.0.0.1:4877
```

Pie Chat requests are recorded with `clientOrigin=pie-chat:web`, so the dashboard can separate browser chat usage from CLI and bridge usage.

## Telegram And Discord Bridge

The bridge is not the Next.js web server. It is a `pie` extension from `apps/chat/extension`.

Because `.pie/settings.json` registers `../apps/chat`, a normal `pie` session from the repository root loads the bridge commands:

```bash
pie
```

Configure accounts and channels:

```txt
/chat-config
```

Connect the current session to one configured channel:

```txt
/chat-connect
```

Or connect directly:

```txt
/chat-connect telegram-pio/dm-donghak-kim
```

For long-running workers:

```txt
/chat-spawn-all
/chat-workers
/chat-open-all
```

Worker mode requires `tmux` and a `pie` command on `PATH` because tmux workers launch `pie` directly. The `pie` executable comes from `@pie-lab/coding-agent`; the chat bridge itself is loaded from `apps/chat` through `.pie/settings.json`.

If you are using only `./pie-test.sh`, link the local CLI first:

```bash
npm run build
npm link --workspace @pie-lab/coding-agent
```

For one-off bridge testing without project settings, load the chat extension explicitly:

```bash
pie -e apps/chat
```

Chat bridge state is stored in:

```txt
~/.pie/agent/chat/
```

More details are in [docs/chat-usage.md](./docs/chat-usage.md).

## Learning Loop

pie-lab includes a Hermes-style Learning Loop adapted to the `pie` runtime.

The request flow is:

```txt
user request
  -> local memory + Honcho context + skill index
  -> pie agent turn
  -> assistant response
  -> background learning review
  -> memory update / skill proposal or write / Honcho sync
  -> next turn can reuse it
```

Important paths:

```txt
~/.pie/agent/memories/MEMORY.md
~/.pie/agent/memories/USER.md
~/.pie/agent/skills/<skill>/SKILL.md
.pie/skills/<project-skill>/SKILL.md
```

The dashboard `Learning` page can inspect memory, review records, proposal approve/reject actions, and skill curator runs.

Honcho is optional. If you want user modeling, set:

```bash
export HONCHO_API_KEY=...
export HONCHO_WORKSPACE_ID=pie-lab
export HONCHO_BASE_URL=...
```

If Honcho is not configured, local memory and skills still work.

## Important Local Files

| Path | Meaning |
|------|---------|
| `~/.pie/agent/settings.json` | Global CLI settings |
| `.pie/settings.json` | Project settings for this repository |
| `~/.pie/agent/auth.json` | Local provider auth storage |
| `~/.pie/agent/provider-connections.json` | Provider connection/account selection state |
| `~/.pie/agent/usage.jsonl` | Usage/cost records |
| `~/.pie/agent/chat/config.json` | Telegram/Discord bridge config |
| `~/.pie/agent/memories` | Persistent memory files |
| `~/.pie/agent/skills` | Agent-created global skills |

## Scripts

| Command | What it does |
|---------|--------------|
| `npm install` | Install workspace dependencies |
| `npm run build` | Build packages, server, dashboard, and chat |
| `npm run dev` | Clear fixed dev ports, then run core watchers plus server, dashboard, and chat |
| `npm run dev:start` | Run the dev stack without clearing existing ports |
| `npm run dev:clean-ports` | Stop listeners on `4873`, `4876`, and `4877` |
| `npm run check` | Format/lint/type-check plus browser smoke check |
| `npm test` | Run workspace tests |
| `./test.sh` | Run tests with API credentials hidden |
| `./pie-test.sh` | Run the source CLI without linking |
| `npm --workspace @pie-lab/pie-chat run check:bridge` | Type-check Telegram/Discord bridge code |

## Troubleshooting

### `EADDRINUSE` or address already in use

`npm run dev` clears the fixed pie-lab ports before starting:

```txt
4873 API server
4876 dashboard
4877 Pie Chat
```

If you started apps separately and only want to clear those ports, run:

```bash
npm run dev:clean-ports
```

If another non-pie process intentionally uses one of those ports, stop it yourself or run the individual app with a different port instead of using the root `npm run dev`.

### `/chat-config` or `/chat-connect` does not appear

Run from the repository root and check that project packages are visible:

```bash
pie list
```

You should see:

```txt
Project packages:
  ../apps/chat
```

If a `pie` session was already open, run `/reload` or restart the session.

### Telegram or Discord messages do not receive replies

Check connection status:

```txt
/chat-status
/chat-workers
```

Restart workers:

```txt
/chat-spawn-all --restart
```

Inspect logs:

```bash
find ~/.pie/agent/chat -name channel.jsonl -print
tail -n 80 ~/.pie/agent/chat/accounts/<account>/channels/<channel>/channel.jsonl
tmux ls
```

Remember: messages typed directly into the local terminal only reply in the terminal. To send a reply back to Telegram or Discord, the turn must start from the remote chat.

### Dashboard keeps refreshing during development

Clear the Next cache and restart the dashboard:

```bash
rm -rf apps/dashboard/.next
npm --workspace @pie-lab/dashboard run dev
```

The dashboard dev script uses webpack mode for a more stable local HMR loop after folder renames.

### No models are available

Add at least one provider credential using `/login`, dashboard `Providers`, or environment variables. Then reload the session or restart the server.

## Documentation

- [docs/README.md](./docs/README.md): documentation index
- [docs/current-decisions.md](./docs/current-decisions.md): current architecture and decisions
- [docs/learning-loop.md](./docs/learning-loop.md): memory, skills, Honcho, curator
- [docs/chat-usage.md](./docs/chat-usage.md): Pie Chat and bridge guide
- [docs/chat-e2e-checklist.md](./docs/chat-e2e-checklist.md): Telegram/Discord verification checklist
- [docs/usage-accounting.md](./docs/usage-accounting.md): usage and cost records
- [docs/deployment.md](./docs/deployment.md): npm and GitHub Pages deployment
- [docs/origins.md](./docs/origins.md): source origins and imported baselines

## Name

`pie` keeps the original `pi` spirit, but in this project it expands toward **Passive Income Engineering**: reusable agents, repeatable workflows, routing discipline, and automation that can keep working after the first manual effort.

The CLI command is `pie`. The local config root is `~/.pie/agent`, and project config lives in `.pie/`.

## License

MIT
