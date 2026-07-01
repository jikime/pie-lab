# 02-architecture — core-loop (pie-lab 통합 설계)

> 입력: `00-brief.md`, `01-od-analysis.md` (둘 다 정독함)
> 전제(확정): 웹앱 = 새 `apps/design` Next.js 앱(사용자 지정, 변경 불가). 서버 = 기존 `apps/server` 확장. 엔진 = `packages/agent`(@pie-lab/agent-core) + `packages/coding-agent`(@pie-lab/coding-agent).
> 이 문서는 **사람 승인 게이트 1**의 입력이며, 4절 **API 계약**이 웹·브리지 두 구현자의 단일 진실 원천이다.

---

## 0. 실제 코드로 확인한 핵심 사실 (해부가 쟁점 1·2 해소)

세 가지 쟁점을 pie-lab 실제 코드로 검증했다. 결론부터:

1. **런타임 교체(AMR → pie agent)는 가능하다.** `createAgentSession()`(`packages/coding-agent/src/core/sdk.ts:54`)이 open-design daemon이 하던 3가지를 모두 제공한다:
   - **(a) 시스템 프롬프트 주입**: `DefaultResourceLoader`의 `appendSystemPrompt: string[]` 옵션(`resource-loader.ts:135`). 스킬 본문 + 디자인시스템 가이드를 여기에 합성해 주입한다. open-design `composeDaemonSystemPrompt()`의 직접 대응.
   - **(b) 파일 쓰기 툴**: 기본 활성 툴이 `[read, bash, edit, write]`(`agent-session.ts:166`). `write` 툴 스키마는 `{ path: string, content: string }`(`coding-agent/src/core/tools/write.ts:16`). 툴은 세션 `cwd`에 바인딩된다 → 에이전트가 `cwd`에 `*.html`을 직접 쓴다. open-design의 "Write 툴 → cwd HTML" 구조와 동일.
   - **(c) 스트리밍 이벤트**: `session.subscribe((event: AgentSessionEvent) => …)`. `AgentSessionEvent`(`agent-session.ts:120`)는 코어 `AgentEvent`(`agent/src/types.ts:403`)를 확장한다. 우리가 쓸 멤버:
     - `{ type: "message_update", message, assistantMessageEvent }` — `assistantMessageEvent.type === "text_delta"`로 텍스트 스트리밍 (이미 `pie-agent-chat-api.ts:527`에서 이 패턴 사용 중).
     - `{ type: "tool_execution_start", toolCallId, toolName, args }` — `toolName === "write"` & `args: { path, content }` → **이것이 곧 "아티팩트 생성" 신호**.
     - `{ type: "tool_execution_end", toolCallId, toolName, result, isError }` — write 완료.
     - `{ type: "agent_end", messages }` / `{ type: "message_end", message }` — 종료.

2. **"아티팩트 이벤트 부재" 문제는 우리 쪽에서 해결한다(쟁점 2).** open-design엔 전용 artifact 이벤트가 없지만, pie agent는 `tool_execution_start/end(toolName:"write")`를 **명시적으로** 준다. 따라서 우리는 파일 폴링/별도 EventSource 없이 **단일 SSE 스트림 안에서 `artifact` 이벤트를 합성**한다. 즉 서버가 write 툴 이벤트를 받아 → `event: artifact` SSE 청크로 변환해 프론트에 보낸다. (open-design의 이원 채널 `/api/runs/:id/events` + `/api/projects/:id/events`을 **단일 스트림으로 단순화**.)

3. **기존 SSE 패턴을 그대로 따른다.** `pie-agent-chat-api.ts`의 `writeSseHeaders`(`text/event-stream`, `x-accel-buffering:no`, keepalive 없음·단순), `writeRawSse`(drain/close 레이스 처리), `data: <json>\n\n` 프레이밍, `[DONE]` 종료를 재사용한다. 프론트 소비도 `apps/chat/src/lib/chat-api.ts`의 `fetch()+getReader()+버퍼 \n\n 분리` 패턴을 그대로 따른다(native EventSource 아님 — open-design도 동일).

> 차이점 한 가지: 기존 pie-agent-chat은 OpenAI 호환 `chat.completion.chunk` 포맷을 쓴다. 디자인 루프는 텍스트뿐 아니라 **artifact 이벤트**가 필요하므로 OpenAI 포맷을 강제하지 않고 **자체 이벤트 유니온**(4절)을 쓴다. 단 전송 메커니즘(헤더·프레이밍·drain 처리·`[DONE]`)은 동일 헬퍼를 따른다.

---

## 1. 이식 매핑 (open-design 요소 → pie-lab 위치)

| open-design 요소 | 역할 | pie-lab 대응 위치 | 비고 |
|---|---|---|---|
| Home 컴포저 `HomeView.tsx`/`HomeHero.tsx` | brief + 스킬 + 디자인시스템 선택, Run | `apps/design/src/app/page.tsx` + `components/Composer.tsx` | Lexical → 단순 `<textarea>`로 축소 |
| `SkillsSection.tsx` / `DesignSystemPicker.tsx` | 선택지 UI | `apps/design/src/components/SkillPicker.tsx`, `DesignSystemPicker.tsx` | 선택지 데이터는 서버 `GET …/options` |
| Studio Prototype / `DesignFilesPanel.tsx` / `FileWorkspace.tsx` | HTML 아티팩트 샌드박스 미리보기 | `apps/design/src/components/ArtifactPreview.tsx` | `<iframe srcDoc sandbox>` |
| `runtime/srcdoc.ts` `buildSrcdoc()` | sandbox 래핑 + baseHref | `apps/design/src/lib/srcdoc.ts` (최소 추출, edit-mode 브리지 제외) | 단일 HTML이면 baseHref 불필요화 가능 |
| daemon `POST /api/runs` | 실행 요청 | `apps/server` `POST /v1/design/runs` | 4절 |
| daemon `/api/runs/:id/events` (SSE) | 실행 스트림 | 동일 `POST /v1/design/runs` 응답이 **즉시 SSE** | 단일 스트림(생성+스트림 합침) |
| daemon `/api/projects/:id/events` (EventSource) | 파일 변화 | **제거** — `artifact` SSE 이벤트로 흡수 | 쟁점 2 결정 |
| `composeDaemonSystemPrompt()` (스킬 본문 + DESIGN.md 주입) | 시스템 프롬프트 합성 | `apps/server/src/design-runs-api.ts` `composeDesignSystemPrompt()` → `createAgentSession({ resourceLoader: new DefaultResourceLoader({ appendSystemPrompt }) })` | 5절 |
| AMR CLI 서브프로세스 스폰 (`runtimes/launch.ts`) | 에이전트 실행 | `createAgentSession()` + `session.prompt()` | **인프로세스**, 서브프로세스 없음 |
| 에이전트 Write 툴 → cwd `*.html` | 아티팩트 생성 | pie agent `write` 툴(`cwd` 바인딩) → run 작업 디렉터리 | 4.4절 경로 규약 |
| `*.html.artifact.json` 매니페스트 (`manifest.ts`) | 아티팩트 메타 | 서버가 write 이벤트에서 합성하는 `ArtifactDescriptor`(인메모리 + 사이드카 JSON) | MVP는 사이드카 선택적 |
| `@open-design/contracts` (chat.ts SSE 스키마, 매니페스트 타입) | 프론트·daemon 공유 타입 | **새 공유 타입 파일** `apps/design/src/lib/design-protocol.ts` (정본) + 서버는 구조적으로 동일 타입 자체 정의 | 7절(공유 타입 위치) |
| `GET /api/projects/:id/archive` ZIP / PDF export | 내보내기 | **MVP 제외**. HTML 단일 다운로드만 — `GET /v1/design/runs/:id/artifact/:name` raw 서빙 | 4.5절 |
| `skills/` SKILL.md 규약 | 디자인 스킬 | **pie-lab 번들 프리셋**(`apps/server/src/design-presets/`)로 1~2개 내장 (5절, `확인 필요`) | |
| `design-systems/airbnb/` DESIGN.md+토큰 | 디자인 시스템 | **DESIGN.md 텍스트만** 1~2 내장 프리셋 (5절, `확인 필요`) | |
| 프로젝트/runs SQLite 스토리지 | 영속 | **MVP: 파일시스템 + 인메모리 run 레지스트리** (`agentDir/design/runs/<runId>/`) | DB 없음 |

---

## 2. 코드 위치 — `apps/design` 구조 + 워크스페이스/빌드 편입

### 2.1 디렉터리 구조
```
apps/design/
  package.json
  next.config.ts
  tsconfig.json
  postcss.config.mjs            # chat과 동일(tailwind v4)
  eslint.config.mjs
  next-env.d.ts
  src/
    app/
      layout.tsx
      globals.css
      page.tsx                  # Home 컴포저 화면(brief + 선택 + Run + 미리보기)
    components/
      Composer.tsx              # brief textarea + 제출
      SkillPicker.tsx           # 디자인 스킬 단일 선택
      DesignSystemPicker.tsx    # 디자인 시스템 선택(null 허용)
      RunStream.tsx             # SSE 소비 + 진행 상태 표시
      ArtifactPreview.tsx       # <iframe srcDoc sandbox>
    lib/
      design-protocol.ts        # ⭐ 공유 타입 정본(4절) — 서버와 1:1 미러
      design-api.ts             # fetch + getReader SSE 파서(chat-api.ts 패턴)
      srcdoc.ts                 # buildSrcdoc 최소 추출
```

### 2.2 워크스페이스 등록
- 루트 `package.json`의 `workspaces`는 이미 `"apps/*"`를 포함 → `apps/design` 디렉터리 추가만으로 워크스페이스 자동 인식. **루트 workspaces 배열 수정 불필요.**
- `apps/design/package.json` 초안(`apps/chat/package.json` 기준, 디자인 루프에 불필요한 discord/gondolin/markdown 의존 제거):
```jsonc
{
  "name": "@pie-lab/design",
  "version": "0.2.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 4878",
    "build": "next build",
    "start": "next start -H 127.0.0.1 -p 4878",
    "lint": "eslint",
    "check": "eslint && next build"   // ⚠ AGENTS.md상 에이전트는 build 실행 금지 → 5·6절 참조
  },
  "dependencies": {
    "next": "16.2.6", "react": "19.2.4", "react-dom": "19.2.4",
    "class-variance-authority": "^0.7.1", "clsx": "^2.1.1",
    "lucide-react": "^1.16.0", "radix-ui": "^1.4.3",
    "tailwind-merge": "^3.6.0", "tw-animate-css": "^1.4.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4", "@types/node": "^20",
    "@types/react": "^19", "@types/react-dom": "^19",
    "eslint": "^9", "eslint-config-next": "16.2.6",
    "tailwindcss": "^4", "typescript": "^5"
  }
}
```
> 포트 할당: server 4873 / dashboard 4876 / chat 4877 / **design 4878**(신규, 충돌 없음). `scripts/kill-dev-ports.mjs`에 4878 추가 필요(`확인 필요`로 표시; 소스 수정이므로 구현자 작업).

### 2.3 tsconfig
- `apps/design/tsconfig.json`은 `apps/chat/tsconfig.json`을 그대로 복제(`paths: { "@/*": ["./src/*"] }`, next plugin, `moduleResolution: bundler`). 루트 tsconfig 참조 변경 불필요(Next 앱은 독립 컴파일).

### 2.4 빌드/dev 스크립트 편입
- 루트 `package.json` `build` 스크립트 끝에 `&& cd ../design && npm run build` 추가.
- 루트 `dev:start`의 `concurrently` 목록에 `"cd apps/design && npm run dev"` + names/colors 한 칸 추가.
- **단, AGENTS.md는 에이전트의 `npm run dev/build` 실행을 금지**한다. 위 두 줄은 **사람이 종단 실행할 때** 필요한 편입이며, 구현자는 *파일만 수정*하고 실행은 사람이 한다. 검증은 `npm run check`(biome + tsgo).

---

## 3. 확장 지점 — 건드릴 기존 파일 vs 새 파일

### 3.1 새로 만드는 파일
| 파일 | 내용 | 담당 |
|---|---|---|
| `apps/server/src/design-runs-api.ts` | `createDesignRunsRequestHandler()` — 라우팅·런 생성·SSE 스트림·아티팩트 서빙·옵션 목록 | 브리지 |
| `apps/server/src/design-presets/index.ts` | 내장 스킬·디자인시스템 프리셋(본문/가이드 텍스트) | 브리지 |
| `apps/design/**`(2.1 전체) | Next.js 웹앱 | 웹 |
| `apps/design/src/lib/design-protocol.ts` | 공유 타입 정본 | 웹(작성) → 브리지가 구조 미러 |

### 3.2 수정하는 기존 파일 (최소)
| 파일 | 변경 | 담당 |
|---|---|---|
| `apps/server/src/index.ts` | (1) `createDesignRunsRequestHandler` import·생성 (2) `isDesignPath()` 추가 (3) 라우터 디스패치에 `if (isDesignPath(url.pathname)) { await designHandler(...); return; }` (4) `export * from "./design-runs-api.ts"` | 브리지 |
| 루트 `package.json` | `build`·`dev:start`에 design 앱 한 줄씩(2.4) | 브리지(사람 실행) |
| `scripts/kill-dev-ports.mjs` | 4878 포트 추가 | 브리지 |

> `pie-agent-chat-api.ts`는 **수정하지 않는다**. SSE 헬퍼(`writeSseHeaders`/`writeRawSse` 등) 로직은 `design-runs-api.ts`에 동일 패턴으로 **복제**한다(공유 추출은 MVP 범위 밖; 기존 파일 변경 최소화 원칙). `createAgentSession`은 `@pie-lab/coding-agent`에서 직접 import.

### 3.3 라우팅 경계
`apps/server/src/index.ts`의 `enforceRequestSecurity` 통과 후 디스패치 체인에 `isDesignPath` 추가. CORS는 기존 `CORS_HEADERS`와 동일 정책(브라우저 출처 허용; design 앱은 `x-pie-client-origin: pie-design:web` 헤더를 보냄).

```ts
function isDesignPath(pathname: string): boolean {
  return pathname === "/v1/design/runs"
    || pathname === "/v1/design/options"
    || /^\/v1\/design\/runs\/[^/]+\/artifact\/[^/]+$/.test(pathname)
    || /^\/v1\/design\/runs\/[^/]+$/.test(pathname);
}
```

---

## 4. ⭐ API 계약 (단일 진실 원천)

> 기준 URL: `NEXT_PUBLIC_PIE_API_BASE_URL ?? "http://127.0.0.1:4873"` (chat 앱과 동일 규약).
> 모든 타입은 `apps/design/src/lib/design-protocol.ts`에 정의(정본). 서버는 동일 구조의 타입을 `design-runs-api.ts`에 자체 선언(빌드 의존 없이 구조적 일치).

### 4.0 공유 타입 (design-protocol.ts)

```ts
// ── 선택지 ───────────────────────────────────────────────
export interface DesignSkillOption {
  id: string;           // "single-page-html"
  title: string;        // "Single-page HTML"
  description: string;
}
export interface DesignSystemOption {
  id: string;           // "minimal"
  title: string;        // "Minimal"
}
export interface DesignOptionsResponse {
  skills: DesignSkillOption[];
  designSystems: DesignSystemOption[];
  defaultSkillId: string;
}

// ── 런 생성 요청 ─────────────────────────────────────────
export interface DesignRunRequest {
  prompt: string;                    // brief (필수, 비어있으면 400)
  skillId: string;                   // primary 디자인 스킬 (필수)
  designSystemId: string | null;     // null = 지정 안 함
  model?: string;                    // 미지정 시 서버 기본 "auto:chat"
  conversationId?: string;           // 미지정 시 서버가 design_<uuid> 생성
}

// ── SSE 이벤트 유니온 (스트림 본문) ──────────────────────
// 전송: `data: <json-of-DesignStreamEvent>\n\n`, 종료는 `data: [DONE]\n\n`
export type DesignStreamEvent =
  | DesignStartEvent
  | DesignProgressEvent
  | DesignTextEvent
  | DesignArtifactEvent
  | DesignDoneEvent
  | DesignErrorEvent;

export interface DesignStartEvent {
  type: "start";
  runId: string;
  conversationId: string;
  model: string;        // 해석된 provider/model 또는 요청 model
}

// 진행 상태(에이전트 라이프사이클/툴 시작 등 비텍스트 신호)
export interface DesignProgressEvent {
  type: "progress";
  phase: "queued" | "running" | "tool_start" | "tool_end";
  label: string;        // 사람이 읽을 라벨 (예: "writing index.html")
  toolName?: string;    // phase가 tool_*일 때
}

// 어시스턴트 텍스트 델타(설명/사고 요약 표시용)
export interface DesignTextEvent {
  type: "text";
  delta: string;
}

// ⭐ 아티팩트 이벤트 — write 툴 신호에서 서버가 합성
export interface DesignArtifactEvent {
  type: "artifact";
  artifact: ArtifactDescriptor;
}

export interface ArtifactDescriptor {
  name: string;             // 파일명, 예: "index.html"
  kind: "html";             // MVP 고정
  status: "streaming" | "complete";
  // status==="complete"일 때만 채워짐. 미리보기는 url을 fetch하거나 inlineHtml 사용.
  url?: string;             // raw 서빙 경로: /v1/design/runs/<runId>/artifact/<name>
  inlineHtml?: string;      // 선택: complete 시 전체 HTML 인라인 동봉(미리보기 즉시화)
  bytes?: number;
}

export interface DesignDoneEvent {
  type: "done";
  status: "succeeded" | "failed" | "aborted";
  artifacts: ArtifactDescriptor[];   // 이번 런이 만든 최종 아티팩트 목록(전부 complete)
}

export interface DesignErrorEvent {
  type: "error";
  message: string;
}
```

### 4.1 `POST /v1/design/runs` — 런 생성 + 즉시 SSE 스트림
- **요청**: `Content-Type: application/json`, body = `DesignRunRequest`. 헤더 `x-pie-client-origin: pie-design:web`.
- **응답**: `Content-Type: text/event-stream`. 스트림은 다음 순서를 보장:
  1. `start` (정확히 1회, 최초)
  2. `progress`(queued→running) → 이후 `text`/`progress`/`artifact`가 순서 없이 interleave
  3. write 툴 실행 시: `progress{phase:"tool_start", toolName:"write", label}` → (write 완료) `artifact{status:"complete"}` + `progress{phase:"tool_end"}`
  4. 종료 직전 `done` (정확히 1회)
  5. 스트림 닫기 직전 `data: [DONE]\n\n`
  - 오류 시: `error` 이벤트 → `done{status:"failed"}` → `[DONE]`.
- **검증(400)**: `prompt` 빈 문자열, `skillId` 미존재 → `{ error: { message, type:"invalid_request_error" } }` (기존 패턴과 동일 JSON 에러 형태).
- **취소**: 클라이언트가 `fetch` `AbortController.abort()` → 서버 `response.on("close")` → `session.abort()` (기존 `pie-agent-chat-api.ts:548` 패턴 그대로).

> **단일 스트림 결정(쟁점 2 확정):** open-design의 `/api/runs` + `/api/runs/:id/events` + `/api/projects/:id/events` 3개를 **이 한 엔드포인트**로 합친다. 런 생성과 이벤트 구독을 분리하지 않음(MVP는 새로고침 중 재개 불필요). 재개가 필요해지면 `GET /v1/design/runs/:id/events?after=` 추가는 후속 feature.

### 4.2 `GET /v1/design/options` — 선택지 목록
- **응답 200**: `DesignOptionsResponse`. 서버가 `design-presets/index.ts`에서 합성.

### 4.3 `GET /v1/design/runs/:id` — 런 상태 조회(폴백/재진입)
- **응답 200**: `{ runId, status: "running"|"succeeded"|"failed"|"aborted", artifacts: ArtifactDescriptor[] }`.
- 새로고침 후 마지막 아티팩트를 다시 미리보기할 때 사용(스트림 재구독 없이).

### 4.4 `GET /v1/design/runs/:id/artifact/:name` — raw HTML 서빙
- **응답 200**: `Content-Type: text/html; charset=utf-8`, body = HTML 원문. iframe `srcDoc` 또는 다운로드(`Content-Disposition: attachment`는 `?download=1` 쿼리 시).
- **404**: 런/파일 없음.
- **경로 안전**: `:name`은 `[A-Za-z0-9._-]+` 화이트리스트만, `..`·슬래시 금지. 실제 파일은 항상 run 디렉터리(4.6) 내부로 해석.

### 4.5 내보내기(MVP 범위)
- HTML 단일 다운로드만: 4.4 + `?download=1`. **ZIP/PDF는 범위 밖**(brief 명시).

### 4.6 아티팩트 저장·조회 방식 (경로 규약)
- run 작업 디렉터리(= 에이전트 `cwd`): `<agentDir>/design/runs/<runId>/`
  - `agentDir = getAgentDir()` (= `~/.pie/agent`, `@pie-lab/coding-agent`에서 import). pie→pie 매핑 메모리상 `.pie` 경로 사용 확인됨.
  - 환경변수 오버라이드: `PIE_DESIGN_RUNS_DIR`(없으면 위 기본).
- 에이전트가 `write{path:"index.html", content}` → 파일이 `<runDir>/index.html`에 쓰임.
- 서버는 write 이벤트(`tool_execution_start/end`)를 받아 `ArtifactDescriptor` 합성 + 인메모리 run 레지스트리(`Map<runId, { status, artifacts, dir }>`)에 등록. 선택적으로 `<name>.artifact.json` 사이드카 작성(조회 영속용).
- 미리보기 우선순위: `artifact` 이벤트의 `inlineHtml`이 있으면 그대로, 없으면 `url`을 fetch.

---

## 5. pie agent 실행 설계

### 5.1 실행 흐름 (design-runs-api.ts 내부)
```
요청(DesignRunRequest)
 → validate(prompt, skillId)
 → runId = `design_<uuid>`, runDir = <agentDir>/design/runs/<runId>/  (mkdir -p)
 → preset = resolvePreset(skillId, designSystemId)          // design-presets
 → appendSystemPrompt = composeDesignSystemPrompt(preset)   // 5.2
 → resourceLoader = new DefaultResourceLoader({
       cwd: runDir, agentDir,
       appendSystemPrompt,
       noSkills: true,            // 사용자 글로벌 스킬 비활성(디자인 루프 격리)
       noContextFiles: true,
       noPromptTemplates: true,
   })
 → { session } = await createAgentSession({
       cwd: runDir, agentDir,
       model: resolveModelReference(modelRegistry, request.model ?? "auto:chat"),
       modelRegistry, usageStore,
       resourceLoader,
       tools: ["write", "read"],  // 디자인 루프엔 write/read만 — bash/edit 비노출
       sessionManager: SessionManager.create(runDir),
   })
 → writeSseHeaders(response)
 → session.subscribe(event => mapToDesignStreamEvent(event) → writeSse)  // 5.3
 → await session.prompt(request.prompt, { source: "rpc" })
 → 종료: done{status, artifacts} → [DONE]
```

### 5.2 시스템 프롬프트 합성 `composeDesignSystemPrompt(preset)`
open-design `composeDaemonSystemPrompt`의 직접 대응. `appendSystemPrompt: string[]` 배열로 다음 블록을 차례로 주입:
1. **디자인 루프 헌법**(고정): "너는 단일 페이지 HTML 아티팩트를 만든다. 작업 디렉터리에 `write` 툴로 `index.html` 한 파일을 쓴다. 외부 자산은 인라인(CSS는 `<style>`, JS는 `<script>`)하거나 CDN을 쓴다. 완성된 전체 문서(`<!doctype html>`)를 한 번에 써라." — 이로써 `tool_use(write)` = 아티팩트 신호가 보장됨.
2. **선택한 디자인 스킬 본문**(`preset.skill.body`, SKILL.md 본문 텍스트).
3. **선택한 디자인시스템 가이드**(`preset.designSystem?.guide`, DESIGN.md 텍스트). `null`이면 생략.

### 5.3 이벤트 매핑 `mapToDesignStreamEvent` (AgentSessionEvent → DesignStreamEvent)
| pie agent `AgentSessionEvent` | DesignStreamEvent |
|---|---|
| `agent_start` | `progress{phase:"running", label:"running"}` |
| `message_update` + `assistantMessageEvent.type==="text_delta"` | `text{delta}` |
| `tool_execution_start` (`toolName:"write"`) | `progress{phase:"tool_start", toolName:"write", label:"writing "+args.path}` + (스트리밍 표시용) `artifact{status:"streaming", name:args.path}` |
| `tool_execution_end` (`toolName:"write"`, !isError) | 파일 읽어 `ArtifactDescriptor{status:"complete", url, inlineHtml?, bytes}` → `artifact` + `progress{phase:"tool_end"}` |
| `tool_execution_end` (isError) | `error{message}` |
| `agent_end` / 정상 종료 | `done{status:"succeeded", artifacts}` |
| prompt() throw / abort | `error` → `done{status:"failed"|"aborted"}` |
> `write` 외 툴(read 등)은 `progress{tool_*}`로만 표시하거나 무시. 텍스트 누적·drain 큐 처리는 `pie-agent-chat-api.ts`의 `enqueueWrite`/`writeQueue` 패턴을 그대로 복제(순서 보장 + 백프레셔).

### 5.4 스킬·디자인시스템 소스 결정 (brief의 두 "확인 필요" → 권장안)
- **디자인 스킬: pie-lab 번들 프리셋 1개로 시작(권장).** open-design `skills/` SKILL.md frontmatter 규약(`od.mode` 등)을 통째 포팅하지 않고, **`design-presets/index.ts`에 단일 `single-page-html` 프리셋**(title/description/body 텍스트)을 둔다. body는 open-design `skills/artifacts-builder/SKILL.md`(mode: prototype) 본문을 참고해 단일-HTML용으로 축약. → pie-lab `DefaultResourceLoader` 스킬 메커니즘(`additionalSkillPaths`)은 **재사용하지 않음**(글로벌 사용자 스킬과 섞이지 않도록 `noSkills:true`). **`확인 필요`: 프리셋 1개로 충분한지, 2개(예: landing-page / dashboard-mock)로 갈지 사람 결정.**
- **디자인시스템: DESIGN.md 텍스트만 1~2 내장 프리셋(권장).** 토큰/`components.html`/manifest 디렉터리 구조는 MVP 제외. `design-presets`에 `{ id:"minimal", title, guide:"<DESIGN.md 텍스트>" }` 1~2개. **`확인 필요`: 어느 디자인시스템 텍스트를 내장할지(예: open-design `design-systems/airbnb/DESIGN.md` 발췌 사용 가능 여부 = 라이선스/출처) 사람 결정.**

---

## 6. 의존성·위험

### 6.1 추가 패키지
- **서버(`apps/server`)**: 신규 npm 의존 **없음**. `@pie-lab/coding-agent`(이미 의존)에서 `createAgentSession`, `DefaultResourceLoader`, `getAgentDir`, `SessionManager` import. `@pie-lab/agent-core` 타입은 `coding-agent`가 재노출. → **`사람 승인 필요` 항목 아님(의존 추가 0).**
- **웹(`apps/design`)**: `apps/chat`의 부분집합(next/react/radix/tailwind/lucide/clsx/cva/tailwind-merge). discord.js·gondolin·markdown 계열 **불필요 → 제외**. 모두 이미 레포에 존재하는 버전 → **새 외부 의존 0**(워크스페이스 신규 패키지만 추가). lockfile 변경은 `npm install --package-lock-only --ignore-scripts`로(AGENTS.md 6.2/Dependency 규칙), `PI_ALLOW_LOCKFILE_CHANGE=1`은 **사람이 커밋할 때만**.

### 6.2 AGENTS.md 충돌·준수
- **금지 명령**: 에이전트는 `npm run dev/build/test` 금지. → 구현자는 파일만 작성하고 검증은 `npm run check`(biome + tsgo). `apps/design`의 `next build`는 tsgo 대상이 아니므로(Next 독립), **웹 구현자는 `npm run check`로 서버 타입만 검증**되고 Next 빌드는 **사람이 종단 실행**. → `사람 승인 필요`: 게이트 1에서 "Next 앱 빌드/실행은 사람이 한다" 확인.
- **erasable TS only**(`packages/*`): `apps/*`는 Next/eslint 컴파일이라 해당 제약 밖이지만, 서버 `apps/server`는 tsgo 대상 → `enum`/`namespace` 금지, `any` 금지 준수.
- **`no inline imports`**: `design-runs-api.ts`는 top-level import만.
- **biome `--error-on-warnings`**: 새 파일 모두 통과해야 함.

### 6.3 위험
| 위험 | 영향 | 완화 |
|---|---|---|
| 에이전트가 `index.html`이 아닌 다른 이름/다중 파일을 쓸 수 있음 | 미리보기 대상 모호 | 시스템 프롬프트(5.2)에서 "단일 `index.html`" 강제 + 서버는 가장 최근 `.html` write를 primary로 선택 |
| 모델이 write 툴을 안 쓰고 텍스트로만 HTML 출력 | 아티팩트 미생성 | 헌법 프롬프트에 "반드시 write 툴 사용" 명시; `done`에 artifacts 비면 프론트가 안내 |
| iframe `sandbox` 보안 | XSS/탈출 | `sandbox="allow-scripts allow-downloads"` 고정(allow-same-origin 금지), srcdoc 인라인 |
| `auto:chat` 모델이 인증 없는 환경에서 실패 | 런 실패 | `error` 이벤트로 명확히 전달(기존 모델 미인증 메시지 재사용) |
| run 디렉터리 누적 | 디스크 | MVP는 정리 안 함; `확인 필요`(후속 TTL 정리) |

### 6.4 게이트 1에서 사람이 결정할 항목 (요약)
1. **스킬 프리셋 수**: `single-page-html` 1개 vs 2개. (5.4)
2. **디자인시스템 텍스트 출처**: 어느 DESIGN.md 텍스트를 내장할지/라이선스. (5.4)
3. **Next 앱 빌드·종단 실행은 사람이 수행** 확인(AGENTS.md). (6.2)
4. **루트 `package.json` build/dev 편입 + `kill-dev-ports.mjs` 4878** 변경 승인. (2.4)
5. 단일 스트림 SSE(파일 이벤트 채널 제거) 설계 승인. (4.1)

---

## 7. 구현 분할

### 7.1 공유 타입 위치 (단일 진실 원천)
- **정본**: `apps/design/src/lib/design-protocol.ts` (4절 전체). **웹 구현자가 작성**.
- **서버 미러**: `apps/server/src/design-runs-api.ts` 상단에 동일 구조 타입을 자체 선언(빌드 의존 없이 구조적 일치). 두 곳 중 하나라도 바뀌면 **양쪽에 동시 통지**(아키텍트 책임).

### 7.2 브리지 구현자 범위 (`apps/server`)
- `apps/server/src/design-runs-api.ts`:
  - `createDesignRunsRequestHandler(options)` + 라우팅(`/v1/design/runs`, `/options`, `/runs/:id`, `/runs/:id/artifact/:name`).
  - run 레지스트리(인메모리 `Map`), runDir 생성/경로 안전(4.4, 4.6).
  - `composeDesignSystemPrompt` + `createAgentSession` 실행(5.1~5.2).
  - `mapToDesignStreamEvent` + SSE 송출(5.3) — `pie-agent-chat-api.ts`의 `writeSse*`/`enqueueWrite` 패턴 복제.
  - raw HTML 서빙(4.4).
- `apps/server/src/design-presets/index.ts`: 스킬·디자인시스템 프리셋 데이터 + `resolvePreset`.
- `apps/server/src/index.ts` 수정(3.2), 루트 `package.json`/`kill-dev-ports.mjs` 수정(2.4·3.2, 실행은 사람).
- **경계**: 브리지는 `design-protocol.ts`를 import하지 않고 **구조 미러**만 둔다(서버↔웹 빌드 결합 방지).

### 7.3 웹 구현자 범위 (`apps/design`)
- `apps/design/**` 전체(2.1): Next 앱 스캐폴드, `Composer`/`SkillPicker`/`DesignSystemPicker`/`RunStream`/`ArtifactPreview`.
- `lib/design-protocol.ts`(정본 작성), `lib/design-api.ts`(fetch+getReader SSE 파서 — `chat-api.ts` 패턴), `lib/srcdoc.ts`(buildSrcdoc 최소).
- `apps/design/package.json`·tsconfig·next.config·postcss·eslint(2.2~2.3, `apps/chat` 복제).
- **경계**: 웹은 서버 내부 구현을 모르고 **4절 API 계약**만 의존. 서버 base URL은 `NEXT_PUBLIC_PIE_API_BASE_URL`.

### 7.4 겹침/접점
- 유일한 접점 = **4절 API 계약**. 두 구현자는 서로의 코드를 보지 않고 4절만으로 병렬 구현 가능.
- 계약 변경 발생 시 아키텍트가 `SendMessage`로 **양쪽 동시 통지**(SKILL.md 규칙).

---

## 부록 — 출처(pie-lab 실제 코드)
- `apps/server/src/pie-agent-chat-api.ts:487-582,897-944` — SSE 헤더/프레이밍/drain/abort 패턴(복제 대상)
- `apps/server/src/index.ts:89-205,257-264` — 라우터 디스패치 + `isPieAgentChatPath` 패턴(확장 대상)
- `apps/chat/src/lib/chat-api.ts:124-215` — fetch+getReader SSE 소비 패턴(웹 복제 대상)
- `packages/coding-agent/src/core/sdk.ts:54-117` — `createAgentSession`/`CreateAgentSessionOptions`
- `packages/coding-agent/src/core/agent-session.ts:120-147,166` — `AgentSessionEvent`, 기본 활성 툴 `[read,bash,edit,write]`
- `packages/coding-agent/src/core/resource-loader.ts:120-153` — `DefaultResourceLoaderOptions.appendSystemPrompt`/`noSkills`
- `packages/coding-agent/src/core/tools/write.ts:16-21` — write 툴 스키마 `{path,content}`
- `packages/agent/src/types.ts:403-418` — 코어 `AgentEvent`(tool_execution_start/end)
- `apps/chat/package.json`, `apps/chat/tsconfig.json` — apps/design 스캐폴드 기준
- 루트 `package.json:workspaces,build,dev:start` — 워크스페이스/빌드 편입 지점
- `AGENTS.md:25-45` — 금지 명령·의존성 보안 규칙
