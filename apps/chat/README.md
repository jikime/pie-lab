# @pie-lab/pie-chat

Next.js chat app and Telegram/Discord bridge based on the existing `pi-chat` source, renamed as `pie-chat` inside pie-lab.

Full usage guide: [docs/chat-usage.md](../../docs/chat-usage.md)

Initial direction:

- Provide the web chat experience for pie-lab users.
- Connect Discord/Telegram channels to pie-lab agent sessions.
- Normalize chat messages through `@pie-lab/chat`.
- Run agents through the pie-lab runtime/router flow.
- Do not call LLM providers directly from this app.

## Stack

- Next.js 16
- React 19
- Tailwind CSS 4
- shadcn/ui style components
- Pretendard

## Run

Start the pie-lab API server first:

```bash
npm --workspace @pie-lab/server run dev
```

Start Pie Chat in another terminal:

```bash
npm --workspace @pie-lab/pie-chat run dev
```

Default URLs:

```txt
Pie Chat: http://127.0.0.1:4877
API server: http://127.0.0.1:4873
```

Use a different API server with:

```bash
NEXT_PUBLIC_PIE_API_BASE_URL=http://127.0.0.1:4873 npm --workspace @pie-lab/pie-chat run dev
```

## Telegram/Discord Bridge

`apps/chat` also exposes a pie extension entry at `extension/index.ts`.

In this repo, the extension is registered in project settings, so a normal `pie` session from the
repo root loads the bridge commands:

```bash
pie
```

For one-off testing without project settings, you can still use `pie -e apps/chat`.

Then configure and connect channels from the TUI:

```txt
/chat-config
/chat-connect
```

The bridge keeps the existing `pi-chat` behavior:

- Discord server channels and Telegram DMs/groups
- one Gondolin sandbox per connected channel
- channel log, account memory, channel memory, skills, and attachments
- `/chat-spawn-all` tmux workers for multiple configured channels
- `chat_history`, `chat_attach`, `chat_request_secret`, and `chat_workers` tools

pie-lab changes:

- worker sessions launch with the `pie` command, not `pi`
- chat bridge state is stored under `~/.pie/agent/chat`
- the package manifest registers the extension through `pi.extensions` for compatibility with the current extension loader

## Current Scope

- Web chat UI
- Telegram/Discord bridge extension
- OpenAI-compatible `/v1/chat/completions` streaming
- Default model `auto:chat`
- Recommended `auto:chat` policy: `google/gemini-3.1-pro-preview` -> `google/gemini-2.5-flash`
- Quick model switching for `auto:chat`, `auto:coding`, and `auto:reasoning`
- Route metadata display for assistant responses
