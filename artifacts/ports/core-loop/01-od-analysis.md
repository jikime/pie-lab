# 01-od-analysis — core-loop (open-design 해부)

> 대상: open-design **핵심 디자인 워크스페이스 루프** (brief 입력 → 스킬·디자인시스템 선택 → 에이전트 실행 → 단일 HTML 아티팩트 샌드박스 미리보기 → 다운로드)
> 범위 밖(존재만 언급): HyperFrame/MP4, Deck/PPTX, 이미지·비디오·오디오 생성, Automation/Routines, Plugins/MCP, 다중 프로젝트 관리, Live Artifact, Critique Theater.
> 소스 루트: `/Users/jikime/Dev/Business/promline/open-design` (web 0.11.0 / daemon 0.11.0)

---

## 1. 기능 요약

open-design는 **로컬-퍼스트 디자인 워크스페이스**다. 사용자가 Home 컴포저에 자연어 brief를 쓰고 (선택적으로) 디자인 스킬과 디자인 시스템을 고른 뒤 "Run"하면, 프론트가 **프로젝트를 만들고 → `POST /api/runs`로 daemon에 에이전트 실행을 요청**한다. daemon은 고른 스킬의 `SKILL.md` 본문과 디자인 시스템의 `DESIGN.md`를 시스템 프롬프트로 합성한 뒤, **에이전트 CLI 런타임(AMR 등)을 서브프로세스로 띄워** 프로젝트 작업 디렉터리(cwd) 안에 HTML 파일을 직접 쓰게 한다. 진행 상황·텍스트·툴 호출은 **SSE(`text/event-stream`)**로 프론트에 흘러가고, 에이전트가 쓴 HTML 파일은 프로젝트 파일 목록에 나타나 **`buildSrcdoc()`로 감싸 `sandbox` 속성을 건 `<iframe srcDoc>`**에 렌더된다. 결과 HTML은 raw 파일 URL 직접 다운로드 또는 ZIP 아카이브로 내보낸다.

핵심: **"아티팩트"는 별도 SSE 이벤트로 오지 않는다.** 에이전트가 Write/create_file 툴로 파일을 쓰고, 그 파일이 프로젝트 트리에 생기면서 미리보기가 갱신된다. SSE는 에이전트의 텍스트·툴 호출·상태를 나르는 채널이다.

---

## 2. 사용자 흐름 (화면 단위)

| 단계 | 화면/동작 | 입력 → 처리 → 출력 |
|---|---|---|
| 1 | Home 컴포저 (`HomeView.tsx` / `HomeHero.tsx`) | brief 텍스트 입력 (Lexical 에디터, `composer/LexicalComposerInput.tsx`) |
| 2 | 스킬 선택 | `SkillsSection.tsx` / 컴포저 @-mention 또는 칩으로 디자인 스킬 1개(primary) + ad-hoc 다수 선택 → `skillId` / `skillIds[]` |
| 2 | 디자인 시스템 선택 | `DesignSystemPicker.tsx` → `designSystemId`(문자열 또는 null = "지정 안 함") |
| 3 | "Run" 클릭 | `HomeView` submit → `onSubmit({prompt, skillId, designSystemId, ...})` (HomeView.tsx:1545) → 프로젝트 생성 + 대화 생성 → `POST /api/runs` (daemon.ts:625) |
| 4 | 실행/스트리밍 | daemon이 스킬+디자인시스템으로 시스템 프롬프트 합성 → 에이전트 CLI 스폰 → SSE로 status/text/tool 이벤트 흘림 (`/api/runs/:id/events`) |
| 4 | 아티팩트 생성 | 에이전트가 Write 툴로 cwd에 `*.html` + `*.html.artifact.json`(매니페스트) 작성 → 프로젝트 파일 목록 갱신 (`/api/projects/:id/events` SSE) |
| 4 | 미리보기 | HTML 파일을 fetch → `buildSrcdoc()` 래핑 → `<iframe srcDoc sandbox="allow-scripts allow-downloads">`에 렌더 (DesignFilesPanel.tsx:1328, FileWorkspace.tsx:3899) |
| 5 | 다운로드 | raw 파일 URL 직접 다운로드(sandbox `allow-downloads`) 또는 `GET /api/projects/:id/archive` ZIP, PDF는 `POST /api/projects/:id/export/pdf` |

---

## 3. UI 계약

### Home 컴포저 입력
| 요소 | 데이터 형태 | 근거 |
|---|---|---|
| brief 프롬프트 | string(`prompt` → 직렬화 `serialize.ts`/`deserialize.ts`) | composer/LexicalComposerInput.tsx, HomeView.tsx:1546 |
| primary 스킬 | `skillId: string \| null` (스킬·칩 상호배타: 칩 쓰면 skillId=null) | HomeView.tsx:1532 |
| ad-hoc 스킬 | `skillIds: string[]` (@-mention 팝오버, 이번 턴만, 프로젝트에 영속 안 함) | server.ts:6599-6611 |
| 디자인 시스템 | `designSystemId: string \| null` | HomeView.tsx:1556, DesignSystemPicker.tsx |
| 첨부 | `attachments: File[]` | HomeView.tsx:1560 |
| 에이전트 | `agentId`(미지정 시 daemon이 첫 가용 에이전트로 폴백) | server.ts:10349-10368 |

### 스킬/디자인시스템 선택지 데이터 (daemon이 제공)
- 스킬·디자인시스템 목록: `daemon`이 `skills.map(s => ({id, title, description}))`, `designSystems.map(d => ({id, title}))` 형태로 노출 (server.ts:6438-6439).
- 스킬 메타데이터(`SkillInfo`): `id, name, description, mode('prototype' 등), category, scenario, designSystemRequired, examplePrompt, body(SKILL.md 본문)` (skills.ts:60-92).
- 디자인 시스템 1개 = 디렉터리: `DESIGN.md`(+로케일별), `manifest.json`, `design-tokens.json`/`tokens.css`, `components.html`(프리뷰), `USAGE.md` (예: `design-systems/airbnb/`).

### 상태 (로딩·스트리밍·에러)
| 상태 | 표현 | 근거 |
|---|---|---|
| 큐/실행중 | `emitRunStatus('queued'\|'running')` | daemon.ts:658, daemon.ts:1022 |
| 스트리밍 | SSE `agent`/`stdout` 이벤트로 텍스트 델타 누적 | daemon.ts:986-1017 |
| 아티팩트 status | 매니페스트 `status: 'streaming' \| 'complete' \| 'error'` (HTML 렌더러는 `supportsStreaming:false` → complete 전까지 스켈레톤) | types.ts:33, renderer-registry.ts:34-44 |
| 에러 | SSE `error` 이벤트(`SseErrorPayload`) / submit 실패 시 "Failed to start the run…" | chat.ts:111, HomeView.tsx:1567 |
| 종료 | SSE `end`(`{code, status:'succeeded'\|'failed'\|'canceled', resumable}`) | chat.ts:70-79 |

---

## 4. 데이터 흐름

### 4.1 Run 요청 본문 (`POST /api/runs`)
프론트가 보내는 핵심 필드 (daemon.ts:608-636, server.ts:6572-6591에서 소비):
```
{
  projectId, conversationId,
  message,            // brief (프롬프트)
  skillId,            // primary 스킬 (영속)
  skillIds,           // 이번 턴 ad-hoc 스킬들
  designSystemId,     // 디자인 시스템 또는 null
  agentId,            // 에이전트 런타임 (미지정 시 daemon 폴백)
  attachments, ...    // (범위 밖: pluginId/appliedPluginSnapshotId/mediaExecution 등)
}
```
응답: `{ runId }` (ChatRunCreateResponse) → 이후 이벤트 스트림 구독.

### 4.2 시스템 프롬프트 합성 (daemon 내부)
`composeDaemonSystemPrompt()`가 (server.ts:6569, 호출 server.ts:7474):
- `skillId`/`skillIds` → `findSkillById()`로 `SKILL.md` 본문(`skill.body`)을 프롬프트 블록에 주입 (server.ts:6655-6699).
- `designSystemId` → 디자인 시스템 `DESIGN.md` 가이드를 주입 (`composeSystemPrompt`로 합성, server.ts:7468-7489).
- 활성 스킬 파일을 cwd의 `.od-skills/<folder>/`로 복사해 에이전트가 참조 가능 (server.ts:7491-7499).
그 뒤 **에이전트 CLI 런타임을 서브프로세스로 스폰**한다(AMR 등; `runtimes/launch.ts` spawn).

### 4.3 스트리밍 (SSE)
- 전송: `Content-Type: text/event-stream`, `event: <type>\ndata: <json>\n\n` 한 write에 묶어 전송, `: keepalive\n\n` 하트비트, `id:` 라인으로 재접속 시 `?after=` 재개 (server.ts:3984-4031).
- 프론트는 **native EventSource가 아니라 `fetch()` + ReadableStream 리더**로 프레임을 파싱(`\n\n` 분리) (daemon.ts:940-984). 최대 5회 재접속(`?after=lastEventId`).
- 별도로 프로젝트 파일/대화 변화는 **native `EventSource`로 `/api/projects/:id/events`** 구독 (project-events.ts:28-64).

#### SSE 이벤트 스키마 (권위 출처: `packages/contracts/src/sse/chat.ts`)
| event | data | 의미 |
|---|---|---|
| `start` | `{runId, agentId, bin, model, projectId, ...}` | 실행 시작 |
| `agent` | `DaemonAgentPayload` 유니온 (아래) | 에이전트 이벤트 |
| `stdout` / `stderr` | `{chunk: string}` | 원시 출력 청크 |
| `error` | `SseErrorPayload` | 에러 |
| `end` | `{code, status, resumable}` | 종료 |

`DaemonAgentPayload` 주요 멤버 (chat.ts:81-104):
- `{type:'status', label, model?, ttftMs?, detail?}` — 진행 상태
- `{type:'text_delta', delta}` — 텍스트 스트리밍
- `{type:'thinking_start'}` / `{type:'thinking_delta', delta}`
- `{type:'tool_use', id, name, input}` — 툴 호출(예: Write로 HTML 작성)
- `{type:'tool_input_delta', id, name, delta}` — 툴 인자 JSON 실시간 조각(코드 작성 라이브 프리뷰용)
- `{type:'tool_result', toolUseId, content, isError?}`
- `{type:'usage', usage, costUsd, durationMs}` / `{type:'raw', line}`

**핵심: `artifact`라는 전용 이벤트가 없다.** 단일 HTML 아티팩트는 ① 에이전트가 `Write`/`create_file` 툴(`tool_use`)로 cwd에 `*.html`를 쓰고 ② 그 파일이 프로젝트 트리에 생겨 미리보기가 갱신되는 방식으로 "스트리밍"된다. (`run-artifacts.ts:41-56` WRITE_OR_EDIT_TOOL_NAMES / extractToolFilePath가 같은 툴 이름을 카운트.)

### 4.4 아티팩트 저장 형태
- 에이전트가 cwd에 **HTML 단일 파일** + 사이드카 **매니페스트** `<entry>.artifact.json` 작성 (manifest.ts:68 `artifactManifestNameFor`).
- 매니페스트(`ArtifactManifest`, types.ts:35-60): `version:1, kind:'html', title, entry, renderer:'html', status, exports:['html','pdf','zip'], primary, sourceSkillId, designSystemId, metadata` (createHtmlArtifactManifest, manifest.ts:72-95).
- 매니페스트 없는 레거시 파일은 확장자로 kind 추론 (`inferLegacyManifest`, manifest.ts:152). `supportingFiles`(다중 파일)는 예약만 되고 현재 생성기는 단일 entry만 씀.

---

## 5. 아티팩트 타입 (이 루프 범위)

| 항목 | 내용 | 근거 |
|---|---|---|
| 종류 | **단일 페이지 HTML** (kind `'html'`, renderer `'html'`) | types.ts:1-21, manifest.ts:72 |
| 미리보기 | HTML fetch → `buildSrcdoc(html, {baseHref})` 래핑 → `<iframe srcDoc sandbox="allow-scripts allow-downloads">` | DesignFilesPanel.tsx:1313-1333, FileWorkspace.tsx:3876-3905 |
| srcdoc 래퍼 | 전체 문서면 그대로, 프래그먼트면 `<!doctype>` 셸로 감쌈; `od-id` 주입, baseHref 주입, sandbox shim 주입 (편집/팔레트 브리지는 옵션) | runtime/srcdoc.ts:38-60 |
| 내보내기 | HTML 단일 다운로드(raw URL), ZIP 아카이브(`GET /api/projects/:id/archive`), 배치 ZIP(`POST .../archive/batch`), PDF(`POST .../export/pdf`) | import-export-routes.ts:413, 451, 511 |
| raw 파일 URL | `projectFileUrl()` = `projectRawUrl()`; daemon이 `/api/projects/:id/preview/...` 등으로 정적 서빙 | registry.ts:1631, project-routes.ts:2268 |

> 범위 밖 타입(deck/react-component/markdown/svg/diagram/mini-app)도 같은 매니페스트·렌더러 레지스트리(renderer-registry.ts:102-108)를 공유한다. MVP는 `html` 렌더러만 필요.

---

## 6. open-design 의존성

| 의존 요소 | 설명 | MVP 영향 |
|---|---|---|
| **AMR (에이전트 CLI 런타임)** | brief를 실제로 처리하는 에이전트가 AMR Cloud / AMR CLI 등 외부 CLI 런타임. daemon이 서브프로세스로 스폰. (CONTEXT.md:55-69, runtimes/launch.ts) | **pie-lab은 pie agent로 대체** — 가장 큰 교체점 |
| **daemon HTTP 서버** | `/api/runs`, `/api/runs/:id/events`(SSE), `/api/projects/:id/events`(EventSource), 파일 raw 서빙·아카이브. Express 기반. (server.ts, chat-routes.ts, project-routes.ts, import-export-routes.ts) | pie-lab은 `apps/server`(SSE 패턴 존재) + 새 `apps/design`로 재구성 |
| **`@open-design/contracts`** | SSE 이벤트 스키마(chat.ts), 매니페스트 타입. 프론트·daemon 공유. | 계약을 pie-lab에 이식/재정의 필요 |
| **skills/ 디렉터리 + SKILL.md 규약** | `name/description/triggers/od.mode/od.category/...` frontmatter + 본문이 시스템 프롬프트로 주입 (skills.ts:35-92). | pie-lab 스킬 메커니즘과 매핑 필요 (brief의 "확인 필요") |
| **design-systems/ + DESIGN.md** | 디자인 시스템 1개 = `DESIGN.md`+`manifest.json`+토큰+`components.html`. (design-systems/airbnb/) | MVP는 1~2 내장 프리셋으로 축소 가능 (brief "확인 필요") |
| **buildSrcdoc + edit-mode 브리지** | `runtime/srcdoc.ts`가 `edit-mode/bridge`(수동 편집 오버레이) import. MVP 미리보기엔 불필요한 브리지 다수. | sandbox 래핑 로직만 최소 추출 |
| **프로젝트 모델/스토리지** | runs/projects를 SQLite(db)로 관리, cwd 작업 디렉터리 개념. | pie-lab은 단일 프로젝트로 축소 가능 |
| **Lexical 에디터** | brief 입력이 Lexical 리치 컴포저(@-mention 스킬 선택). | 단순 textarea로 대체 가능 |

---

## 7. pie-lab 이식 시 쟁점

1. **에이전트 런타임 교체 (AMR → pie agent) — 최대 쟁점.**
   open-design는 AMR CLI를 서브프로세스로 스폰하고, 에이전트가 **Write 툴로 cwd에 HTML 파일을 직접 쓰는** 구조다. pie-lab의 `packages/agent`+`packages/coding-agent`가 동일하게 (a) 시스템 프롬프트 주입 (b) 파일 쓰기 툴 (c) 스트리밍 이벤트를 낼 수 있는지 검증 필요. `확인 필요`: pie agent의 툴 이벤트가 open-design `tool_use`/`tool_input_delta` 형태와 매핑되는가.

2. **"아티팩트 스트리밍"의 의미 차이.**
   open-design엔 전용 `artifact` SSE 이벤트가 없다 — 파일 쓰기 + 프로젝트 파일 이벤트로 미리보기가 갱신된다. pie-lab `apps/server`의 기존 SSE 패턴이 "토큰/텍스트 스트리밍"만이라면, **파일-쓰기 완료 → 미리보기 트리거** 메커니즘(또는 명시적 artifact 이벤트)을 새로 설계해야 한다. 설계자가 SSE 계약을 단순화(예: `status`/`text_delta`/`tool_use`/`artifact`/`end`)할지 결정.

3. **스킬·디자인시스템 소스 결정 (brief의 두 "확인 필요").**
   - 디자인 스킬: open-design `skills/`의 SKILL.md frontmatter 규약을 그대로 포팅할지 vs pie-lab 기존 스킬 메커니즘 재사용. MVP는 단일-페이지-HTML용 스킬 1~2개면 충분 (`mode: prototype`).
   - 디자인 시스템: `DESIGN.md` 전체 디렉터리(토큰/컴포넌트 프리뷰 포함)는 무겁다. MVP는 1~2개 내장 프리셋(DESIGN.md 텍스트만 프롬프트 주입)으로 축소 권장.

4. **샌드박스 미리보기 보안/자산 경로 (중간 쟁점).**
   `<iframe srcDoc sandbox="allow-scripts allow-downloads">` + `buildSrcdoc(baseHref)`가 상대 자산을 raw 파일 URL로 풀어준다. pie-lab `apps/design`에서도 (a) 프로젝트 파일을 raw로 서빙하는 엔드포인트와 (b) baseHref 주입이 필요. `srcdoc.ts`의 edit-mode/팔레트 브리지는 MVP에서 제외하고 sandbox 래핑+baseHref만 최소 추출.

---

## 8. 출처

- `apps/web/src/artifacts/types.ts:1-60` — ArtifactKind/Manifest/Status 타입
- `apps/web/src/artifacts/manifest.ts:68-189` — 매니페스트 생성/파싱, `<entry>.artifact.json` 명명
- `apps/web/src/artifacts/renderer-registry.ts:34-108` — HTML 렌더러, supportsStreaming, 레지스트리
- `apps/web/src/runtime/srcdoc.ts:1-60,712-720` — buildSrcdoc 샌드박스 래퍼, allow-scripts
- `apps/web/src/components/DesignFilesPanel.tsx:1302-1340` — HTML 프리뷰 iframe (srcDoc, sandbox="allow-scripts allow-downloads")
- `apps/web/src/components/FileWorkspace.tsx:3860-3908` — HTML 인라인 프리뷰 iframe
- `apps/web/src/components/HomeView.tsx:1520-1585` — Home 컴포저 submit 페이로드(prompt/skillId/designSystemId/...)
- `apps/web/src/providers/daemon.ts:608-674,935-1024` — POST /api/runs, fetch 기반 SSE 리더, 이벤트 처리
- `apps/web/src/providers/project-events.ts:27-186` — /api/projects/:id/events EventSource 구독
- `apps/web/src/providers/registry.ts:1631-1633,1958` — projectFileUrl/projectRawUrl
- `packages/contracts/src/sse/chat.ts:52-113` — SSE 이벤트 스키마(start/agent/stdout/stderr/error/end, DaemonAgentPayload)
- `apps/daemon/src/server.ts:3984-4031` — createSseResponse(text/event-stream, event/data/id, keepalive)
- `apps/daemon/src/server.ts:6569-6699,7468-7499` — composeDaemonSystemPrompt(스킬 본문+디자인시스템 주입, 스킬 파일 cwd 복사)
- `apps/daemon/src/server.ts:6428-6439` — 스킬/디자인시스템 목록 노출 형태({id,title,description})
- `apps/daemon/src/server.ts:10247-10376` — POST /api/runs 본문 처리, agentId 폴백
- `apps/daemon/src/skills.ts:35-92,164-238` — SKILL.md frontmatter 파싱, SkillInfo 필드
- `apps/daemon/src/run-artifacts.ts:38-60` — WRITE_OR_EDIT_TOOL_NAMES(파일 쓰기 = 아티팩트)
- `apps/daemon/src/import-export-routes.ts:413-447,451,511,572` — ZIP 아카이브/배치/PDF/preview export 라우트
- `apps/daemon/src/project-routes.ts:1512,2268,2413` — /events SSE, raw preview 파일 서빙
- `design-systems/airbnb/` — 디자인 시스템 디렉터리 구조(DESIGN.md, manifest.json, tokens, components.html)
- `skills/artifacts-builder/SKILL.md:1-14` — 스킬 frontmatter 예(od.mode: prototype)
- `CONTEXT.md:11-69` — Normal Artifact / Artifact Entry File / Artifact Manifest / AMR 도메인 정의
