# @pie-lab/pie-chat

Next.js chat app based on the existing `pi-chat` source, renamed as `pie-chat` inside pie-lab.

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

## Current Scope

- Web chat UI
- OpenAI-compatible `/v1/chat/completions` streaming
- Default model `auto:chat`
- Recommended `auto:chat` policy: `google/gemini-3.1-pro-preview` -> `google/gemini-2.5-flash`
- Quick model switching for `auto:chat`, `auto:coding`, and `auto:reasoning`
- Route metadata display for assistant responses
