# 04-bridge-impl — core-loop 브리지 구현 노트

> 입력: `00-brief.md`(게이트 1 승인), `02-architecture.md` §4 API 계약(단일 진실 원천).
> 스코프: `apps/server` + `packages/*` 연결만. `apps/design`(프론트)은 미수정.
> 검증: `npx tsgo --noEmit` = exit 0(에러 0). `biome check --error-on-warnings .` = 733 파일 clean.

---

## 1. 만든/수정한 파일

### 새 파일
- `apps/server/src/design-presets/index.ts:1` — 내장 프리셋 + 시스템프롬프트 합성.
  - `DESIGN_LOOP_CONSTITUTION:39` — 디자인 루프 헌법(단일 `index.html` write 강제). `write`=아티팩트 신호 보장.
  - `single-page-html` 스킬 1개(`SINGLE_PAGE_HTML_SKILL:62`) — 게이트 1 결정대로 1개.
  - 디자인시스템 2개: `minimal`, `vibrant`(우리가 직접 쓴 중립 텍스트, 외부 발췌 0 → 라이선스 무관).
  - `resolvePreset(skillId, designSystemId):158`, `composeDesignSystemPrompt(preset):176` — open-design `composeDaemonSystemPrompt` 대응.
- `apps/server/src/design-runs-api.ts:1` — 브리지 핸들러 전체.
  - 프로토콜 타입(구조 미러, `design-protocol.ts` import 안 함): `DesignRunRequest`, `DesignStreamEvent` 유니온, `ArtifactDescriptor` 등 `:53~140`.
  - `isDesignPath(pathname):167` — 라우터 경계(§3.3 정규식 그대로).
  - `createDesignRunsRequestHandler(options):182` — 인메모리 run 레지스트리(`Map<runId, RunRecord>`).
  - `handleCreateRun`(`POST /runs`) `:281`, `streamRun`(SSE) `:367`, `handleSessionEvent`(이벤트 매핑) `:480`, `handleRunStatus`(`GET /runs/:id`) `:560`, `handleServeArtifact`(raw HTML) `:577`.

### 수정한 기존 파일
- `apps/server/src/index.ts`
  - import 추가(`:36`), `export * from "./design-runs-api.ts"`(`:54`), `PieLabServerOptions extends DesignRunsApiOptions`(`:78`).
  - `designRunsHandler` 생성(`modelRegistry`/`usageStore` 주입), 디스패치에 `if (isDesignPath(...))` 추가(`isPieAgentChatPath` 뒤).
- `scripts/kill-dev-ports.mjs:5` — `DEFAULT_PORTS`에 `4878` 추가.
- `package.json`
  - `build` 끝에 `&& cd ../design && npm run build` 추가.
  - `dev:start` concurrently에 `design`(`cd apps/design && npm run dev`) + name/color 한 칸 추가.
  - ⚠ AGENTS.md상 에이전트는 build/dev 실행 금지 → **파일만 수정, 종단 실행은 사람**. `apps/design`이 아직 없으면 `npm run dev`/`build`가 design 단계에서 실패하므로 **웹 구현자의 `apps/design` 스캐폴드 완료 후에만** 종단 실행 가능.

---

## 2. 엔드포인트 실측 사양 (계약 대비)

| 엔드포인트 | 구현 | 계약 일치 |
|---|---|---|
| `POST /v1/design/runs` | 즉시 `text/event-stream`. 순서: `start`(1회) → `progress{queued}` → `progress{running}`(agent_start) → `text`/`progress`/`artifact` interleave → `done`(1회) → `data: [DONE]`. | §4.1 일치 |
| `GET /v1/design/options` | `{ skills[], designSystems[], defaultSkillId:"single-page-html" }` | §4.2 일치 |
| `GET /v1/design/runs/:id` | `{ runId, status, artifacts[] }`. 미존재 404. | §4.3 일치 |
| `GET /v1/design/runs/:id/artifact/:name` | `text/html; charset=utf-8`. `?download=1` → `Content-Disposition: attachment`. name 화이트리스트 `[A-Za-z0-9._-]+`, run 디렉터리 내부로만 해석. 미존재 404. | §4.4 일치 |

- 검증(400): `prompt` 빈 문자열, `skillId` 미존재/누락, 타입 오류 → `{ error: { message, type:"invalid_request_error" } }`(기존 패턴 동일).
- 모델 미해결 400, 모델 미인증 등 실행 실패 → 스트림 내 `error` → `done{status:"failed"}` → `[DONE]`.
- 취소: `response.on("close")` → `session.abort()` (pie-agent-chat-api 패턴 그대로). abort 시 `done{status:"aborted"}`.

---

## 3. pie agent write 툴 → artifact SSE 매핑 방식

### 실행(`streamRun`)
```
runId = design_<uuid>, runDir = <agentDir>/design/runs/<runId>/  (mkdir -p, PIE_DESIGN_RUNS_DIR 오버라이드)
appendSystemPrompt = composeDesignSystemPrompt(preset)   // 헌법 + 스킬본문 + (있으면)디자인시스템
resourceLoader = new DefaultResourceLoader({ cwd:runDir, agentDir, appendSystemPrompt,
                    noSkills:true, noPromptTemplates:true, noContextFiles:true, noExtensions:true })
await resourceLoader.reload()
session = createAgentSession({ cwd:runDir, agentDir, model, modelRegistry, usageStore,
                    resourceLoader, tools:["write","read"], sessionManager: SessionManager.inMemory(runDir) })
session.subscribe(handleSessionEvent) ; await session.prompt(prompt, { source:"rpc" })
```

### 이벤트 매핑(`handleSessionEvent`, §5.3 표 구현)
- `agent_start` → `progress{phase:"running"}`.
- `message_update` + `assistantMessageEvent.type==="text_delta"` → `text{delta}`(빈 델타 무시).
- `tool_execution_start{toolName:"write", args:{path}}` → `progress{phase:"tool_start", toolName:"write", label:"writing <name>"}` + `artifact{status:"streaming", name}`.
- `tool_execution_end{toolName:"write", isError:false}` → 파일 stat/read로 `ArtifactDescriptor{status:"complete", url, inlineHtml(≤2MB), bytes}` 합성 → 레지스트리 등록 + 사이드카 JSON(best-effort) + `artifact` 이벤트 + `progress{phase:"tool_end"}`.
- `tool_execution_end{isError:true}` → `error{message}` + `progress{tool_end}` + run `failed` 표시.
- write 외 툴(read 등) → `progress{tool_*}`로만 표시.
- 종료: prompt() 정상 반환 시 `done{status: sawError?"failed":"succeeded", artifacts}`; throw 시 abort 판정으로 `failed`/`aborted`.

### 아티팩트 이름 결정
- write 결과 텍스트("Successfully wrote N bytes to <path>.")에서 path를 파싱 → basename. 정규식 `wrote .* bytes to (.+?)\.?$`.
- args.path가 streaming 단계 라벨/이름 소스. complete 단계는 결과 텍스트가 진실(실제 쓰인 경로).
- SSE 순서 보장: `writeQueue`(Promise 체인)로 직렬화 — pie-agent-chat-api의 `enqueueWrite` 패턴 복제. 백프레셔는 `writeRawSse`의 drain/close/error 레이스 처리로 흡수.

---

## 4. 결정·미완·확인 필요

### 결정(설계 준수)
- SSE 전송 헬퍼(`writeSseHeaders`/`writeSse`/`writeSseDone`/`writeRawSse`)는 `pie-agent-chat-api.ts`를 **복제**(공유 추출 안 함, §3.2 원칙). `pie-agent-chat-api.ts` 미수정.
- 공유 타입은 `design-protocol.ts`를 **import 하지 않고 구조 미러**(서버↔웹 빌드 결합 방지, §7.1).
- `SessionManager.inMemory(runDir)` 사용 — 디자인 런은 1회성이라 세션 영속 불필요(채팅과 달리 재개 안 함). cwd만 runDir로 바인딩되어 write가 runDir에 안착.
- `noExtensions:true` 추가(설계의 noSkills/noPromptTemplates/noContextFiles에 더해) — 글로벌 확장이 디자인 루프 격리를 깨지 않도록.

### B-1 보강 (게이트 2 전, 검증자 비차단 결함)
- **무엇**: write 완료 시 아티팩트 파일명을 결정하는 로직을, **`tool_execution_start`의 `args.path`를 1순위 진실 원천**으로 바꿨다(완료 메시지 텍스트 파싱은 fallback으로 강등).
- **어디**: `apps/server/src/design-runs-api.ts` — `RunRecord`에 `pendingWrites: Map<toolCallId, basename>` 추가(`:165`, 생성 `:356`). `handleSessionEvent`의 `tool_execution_start(write)`에서 `args.path` basename을 `toolCallId`로 보관(`:511`), `tool_execution_end(write)`에서 그 path를 우선 사용(`pendingName ?? artifactNameFromResult(...)`, `:541`·`:549`). 헬퍼 재작성: `artifactNameFromArgs`/`artifactNameFromResult`가 공통 `validatedArtifactName()`(whitelist `[A-Za-z0-9._-]+` + `.html` 확장자 검증)을 통과(`:667~692`). result 파싱 정규식은 `wrote\s+\d+\s+bytes\s+to\s+(\S+)`로 **공백 단위 토큰만 캡처**해 뒤따르는 `<note>` 문장을 구조적으로 배제하고 끝의 마침표만 제거.
- **왜**: hashline 프리픽스 자동제거 시 완료 메시지에 `<note>`가 붙으면 기존 `(.+?)\.?$`가 note까지 캡처 → 파일명 검증 실패 → `artifact{status:"complete"}`·`done.artifacts` 누락 → 미리보기/다운로드(핵심 산출물)가 안 뜰 수 있었다. start의 `args.path`는 note 오염이 없어 결정적이다. **API 이벤트 필드는 불변**(내부 파일명 결정 로직만 보강), 프론트(`apps/design`) 미접근.

### 미완 / 후속
- run 디렉터리 누적 정리(TTL) 없음 — MVP 범위 밖(§6.3). `PIE_DESIGN_RUNS_DIR`로 위치 제어만 제공.
- 사이드카 `<name>.artifact.json`은 작성하지만 **프로세스 재시작 후 레지스트리 복원 로직은 미구현**(`GET /runs/:id`는 인메모리 `Map` 기준). 재시작 후 `:id` 조회는 404가 될 수 있으나, `artifact/:name` raw 서빙은 디스크 파일이 있으면 동작(레지스트리 없이 runId 화이트리스트로 runDir 해석). MVP 허용 범위.

### 확인 필요
- `// 확인 필요` 코드 주석은 없음 — 계약을 모호함 없이 구현 가능했음.
- **디자인시스템 프리셋 2개(`minimal`, `vibrant`)로 구현.** 게이트 1이 "1~2개"를 허용했고 자체 중립 텍스트라 라이선스 이슈 없음. 1개만 원하면 `design-presets/index.ts`의 `DESIGN_SYSTEM_PRESETS` 배열에서 제거하면 됨. → **웹/설계 확인 권장**(옵션 UI가 2개를 표시하게 됨).
- **`inlineHtml`은 ≤2MB일 때 complete 아티팩트에 동봉**(미리보기 즉시화, §4.6 우선순위). 프론트가 url만 쓰면 무시 가능. 페이로드 크기 우려 시 끄는 임계값(`MAX_INLINE_HTML_BYTES`) 조정 가능.
- `package.json` build/dev에 design 편입을 넣었으나 **`apps/design`이 아직 없으면 종단 `npm run dev/build` 실패**. 웹 구현자 스캐폴드 완료 전까지 사람이 종단 실행 보류 필요.

---

## 5. 검증자 체크포인트

1. `npx tsgo --noEmit` → exit 0(완료 확인됨).
2. `biome check --error-on-warnings .` → 0 warning(733 파일 clean, 확인됨).
3. 계약 스키마 일치: `DesignStreamEvent` 유니온 멤버·필드명이 §4.0과 1:1인지(서버 미러 vs `apps/design/src/lib/design-protocol.ts` 정본) — 웹 구현자 작성본과 대조 필요.
4. SSE 순서: `start`→`progress`→...→`done`→`[DONE]` (정확히 start 1회, done 1회).
5. 경로 안전: `artifact/:name`이 `..`·슬래시 거부, runDir 밖 접근 불가.
6. abort: 클라이언트 disconnect 시 `session.abort()` 호출되고 행(hang) 없음(`writeRawSse` drain/close 레이스).
7. `pie-agent-chat-api.ts` 무수정, `apps/design` 무접근, `models.generated.ts` 무수정 확인.
