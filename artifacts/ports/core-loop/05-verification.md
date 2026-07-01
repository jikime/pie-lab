# 05-verification — core-loop (검증, port-verifier)

> 입력 정독: `02-architecture.md`(§4 API 계약=기준), `03-web-impl.md`, `04-bridge-impl.md`, 양쪽 실제 코드, 원본 open-design(`/Users/jikime/Dev/Business/promline/open-design`).
> 검증 방법: 계약 교차 정독 + 실제 에이전트 타입(`packages/agent`, `packages/coding-agent`, `packages/ai`) 대조 + `npm run check` 실행 + 원본 흐름 대조.
> **`npm run dev/build/test` 미실행**(AGENTS.md). 종단 실행은 §사람 실행 절차로 분리.
> 이 문서는 **사람 승인 게이트 2**의 입력이다.
> 갱신: 2026-06-19 — 브리지 B-1 보강 재검증 반영(§E, 항목12 판정 갱신).

---

## A. 항목별 판정표

### A.1 API 계약 일치 (§4 = 단일 진실 원천)

| # | 검증 항목 | 판정 | 근거 / 위치 |
|---|---|---|---|
| 1 | 공유 타입 유니온 1:1 (`start/progress/text/artifact/done/error`) — 멤버·필드·리터럴 | **통과** | 웹 정본 `design-protocol.ts:39-93` ↔ 서버 미러 `design-runs-api.ts:55-140`. 필드명·옵셔널·문자열 리터럴(`status:"streaming"\|"complete"`, `phase:"queued"\|"running"\|"tool_start"\|"tool_end"`, `done.status:"succeeded"\|"failed"\|"aborted"`)이 글자 단위로 동일. |
| 2 | `DesignRunRequest` 필드(`prompt/skillId/designSystemId/model?/conversationId?`) | **통과** | 웹 전송 `design-api.ts:87-95`(`prompt/skillId/designSystemId`만 전송, model/conversationId 생략→서버 기본값) ↔ 서버 수신·검증 `design-runs-api.ts:308-339`. `designSystemId: string\|null` 매핑은 `DesignSystemPicker.tsx:31-36`(빈문자열↔null) 정합. |
| 3 | 엔드포인트 경로·메서드 (`POST /runs`, `GET /options`, `GET /runs/:id`, `GET /runs/:id/artifact/:name`) | **통과** | 웹 호출 `design-api.ts:20,38,59,87` ↔ 서버 라우팅 `design-runs-api.ts:177-184,243-279`. `isDesignPath` 정규식이 §3.3과 동일. |
| 4 | SSE 프레이밍·`[DONE]` 종료·순서 보장 | **통과** | 서버: `start`(1회)→`progress{queued}`→`progress{running}`→interleave→`done`(1회)→`data: [DONE]`(`design-runs-api.ts:393-453`). 순서는 `writeQueue` Promise 체인으로 직렬화(`:385-391`). 웹 파서: `\n\n` 분리 + `data:` prefix + `[DONE]` 스킵(`design-api.ts:105-141`). |
| 5 | `artifact.url` 절대/상대 정합 | **통과** | 서버는 **상대** 경로 `"/v1/design/runs/<id>/artifact/<name>"` 생성(`design-runs-api.ts:621`). 웹 `resolveArtifactUrl`(`design-api.ts:67-73`)이 상대→`API_BASE_URL` prefix. `ArtifactPreview.tsx:44`에서 `resolveArtifactUrl(url)`로 fetch → 정합. (웹은 절대 url도 방어하나 서버가 상대만 주므로 실사용 경로 단일.) |
| 6 | 400 검증 에러 형태 (`{error:{message,type:"invalid_request_error"}}`) | **통과** | 서버 `design-runs-api.ts:311,321,331,571` ↔ 웹 `readErrorMessage`가 `body.error.message` 파싱(`design-api.ts:143-158`). |
| 7 | 취소(abort) 규약 | **통과** | 웹 `AbortController` → `fetch signal`(`page.tsx:75-92`, `design-api.ts:87-95`). 서버 `response.on("close")` → `session.abort()`(`design-runs-api.ts:405-410`). 웹은 abort 시 `phase="aborted"`(`page.tsx:95-100`). |
| 8 | options 응답 구조(`skills[]/designSystems[]/defaultSkillId`) | **통과** | 서버 `buildOptionsResponse`(`design-runs-api.ts:286-299`) ↔ 웹 소비 `page.tsx:44-47`. 프론트 하드코딩 0(SkillPicker/DesignSystemPicker 모두 props). |

### A.2 에이전트 경계 — 서버↔pie agent 실제 타입 대조 (계약 외 두 번째 경계면)

| # | 검증 항목 | 판정 | 근거 |
|---|---|---|---|
| 9 | `createAgentSession({tools:[...]})` 옵션명 정확성 | **통과** | `CreateAgentSessionOptions.tools?: string[]`(`packages/coding-agent/src/core/sdk.ts:87`) 존재 → `tools:["write","read"]`(`design-runs-api.ts:432`) 유효 allowlist. |
| 10 | `message_update.assistantMessageEvent.type==="text_delta"`의 `.delta` 접근 | **통과** | `text_delta`는 `{type, contentIndex, delta:string, partial}`(`packages/ai/src/types.ts:363`). 서버 `event.assistantMessageEvent.delta`(`design-runs-api.ts:496-497`) 정합. 기존 `pie-agent-chat-api.ts`와 동일 패턴. |
| 11 | `tool_execution_start/end`의 `toolName/args/result/isError` + `toolCallId` 연결 키 | **통과** | 코어 `AgentEvent`(`packages/agent/src/types.ts:416-418`)와 일치. `AgentSessionEvent`가 `Exclude<AgentEvent, agent_end>`로 재노출(`agent-session.ts:119`). **start/end 동일 `toolCallId` 보장**: 둘 다 `toolCall.id` 사용(`agent-loop.ts:408-409, 719-720`, serial·parallel 경로 동일) → B-1 보강의 연결 키 정당(§E-1). |
| 12 | write 결과 → 아티팩트 이름 결정 (B-1) | **통과** | B-1 보강 후 재검증 완료. `args.path`(start) 1순위 + result 텍스트 fallback이 모두 `validatedArtifactName`(whitelist+`.html`) 통과. note 접미 경로 닫힘. **상세 §E.** |

### A.3 정적/타입 검사

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 13 | `npm run check` (biome `--write --error-on-warnings` + tsgo `--noEmit` + browser-smoke) | **통과** | B-1 보강 후 재실행: biome `Checked 733 files … No fixes applied`(0 경고/오류), tsgo `--noEmit` 오류 0, browser-smoke 완료. 이 tsgo는 `apps/server`+`packages/*` 대상(Next 독립 `apps/design` 제외). |
| 14 | `apps/design` 독립 타입체크 | **통과(보강)** | `apps/design`엔 `node_modules` 미설치라 로컬 tsgo 불가. 루트 hoisted `npx tsgo --noEmit -p apps/design/tsconfig.json` → **exit 0**. (Next 플러그인/JSX 포함 `next build`는 사람 종단 단계.) |

### A.4 원본 대조 (open-design 핵심 루프 → 이식본)

| open-design 단계 | 이식본 위치 | 판정 |
|---|---|---|
| brief 입력(Lexical) | `Composer.tsx:49-64` textarea(축소) | **통과** |
| 스킬+디자인시스템 선택 | `SkillPicker.tsx`/`DesignSystemPicker.tsx`(서버 옵션) | **통과** |
| 실행(daemon `POST /api/runs` + 서브프로세스) | `POST /v1/design/runs` + 인프로세스 `createAgentSession`(`design-runs-api.ts:362-371,431-449`) | **통과**(설계대로 단일 스트림·인프로세스 단순화) |
| Write 툴 → cwd `*.html` → 미리보기 트리거(원본은 별도 프로젝트 파일 EventSource) | write 이벤트 → `artifact` SSE 합성(`design-runs-api.ts:504-559`) | **통과**(쟁점2 설계대로 단일 스트림 흡수) |
| 샌드박스 iframe 미리보기(원본 `DesignFilesPanel.tsx` = `sandbox="allow-scripts allow-downloads"`) | `ArtifactPreview.tsx:160` `sandbox="allow-scripts allow-downloads"` | **통과**(원본 실제 패널과 글자 단위 동일) |
| HTML 다운로드 | `artifactUrl(...,true)` → `?download=1` → `Content-Disposition: attachment`(`ArtifactPreview.tsx:66`, `design-runs-api.ts:596-598`) | **통과** |

### A.5 견고성

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 15 | iframe sandbox 격리(allow-same-origin 금지) | **통과** | `ArtifactPreview.tsx:160` 정확히 `allow-scripts allow-downloads`. same-origin 미부여. srcDoc 인라인. |
| 16 | 스트리밍 청크 처리(부분 `\n\n` 경계) | **통과** | 웹 `buffer.split("\n\n")` 후 `buffer = chunks.pop()`로 미완 청크 보존, 루프 종료 후 잔여 flush(`design-api.ts:110-120`). |
| 17 | 에러/로딩/빈 상태 | **통과** | 옵션 로드 실패 배너(`page.tsx:153-158`), run 실패/중지 phase(`RunStream.tsx`), 미리보기 빈/로딩/fetch에러 분기(`ArtifactPreview.tsx:138-172`). |
| 18 | abort 시 서버 hang 방지 | **통과** | `writeRawSse` drain↔close↔error 레이스 처리(`design-runs-api.ts`), `pie-agent-chat-api.ts` 패턴 복제. |
| 19 | 경로 안전(`artifact/:name`) | **통과** | `ARTIFACT_NAME_PATTERN=/^[A-Za-z0-9._-]+$/`로 `..`·슬래시 거부(`design-runs-api.ts:169,570`). runId도 `sanitizeRunId` 화이트리스트, 파일은 항상 runDir 내부 `join`. |
| 20 | 라우터 디스패치 순서 | **통과** | `isDesignPath`가 `isPieAgentChatPath` 뒤·일반 provider/media 앞(`index.ts:158-161`). 비충돌. |

### A.6 알려진 갭 평가 (MVP 핵심 루프 영향 판정)

| 갭 | 출처 | 핵심 루프 깨뜨림? | 판정 |
|---|---|---|---|
| 재시작 후 인메모리 레지스트리 미복원 → `GET /runs/:id` 404 가능 | 04-bridge §4 | **아니오** | 핵심 루프는 인메모리 레지스트리 생존 구간에서 완결. `GET /runs/:id`는 재진입 폴백용·MVP UI 미사용. `artifact/:name` raw 서빙은 레지스트리 없이 디스크+runId 화이트리스트로 동작 → 재시작 후에도 다운로드 링크 생존. **허용.** |
| 다중 아티팩트 미구현(최근 1개 primary) | 03-web §4 | **아니오** | 헌법 프롬프트가 단일 `index.html` 강제. 단일-HTML 루프 정의상 정상. |
| PDF/ZIP 내보내기 비범위 | 00-brief §14 | **아니오** | brief 명시 범위 밖. |

---

## B. 발견한 결함 → 되돌릴 구현자 + 수정 지시

### B-1. (해결됨) write 결과 `note` 접미로 인한 아티팩트 이름 파싱 실패
- **구현자**: 브리지
- **초기 현상(보강 전)**: write 성공 메시지 `"Successfully wrote N bytes to <path>.<note>"`에서 hashline 프리픽스 자동 제거 시 `<note>`가 붙으면 구 정규식 `(.+?)\.?$`가 note 문장까지 캡처 → 이름 검증 실패 → complete 아티팩트·`done.artifacts` 누락 → 미리보기/다운로드 미표출 가능.
- **상태**: **해결됨(closed)**. 브리지가 `toolCallId` 기반 `pendingWrites` + 정규식 교체 + 공통 검증으로 보강. **재검증 통과 — §E 참조.**

> 그 외 계약·경계면 위반 결함 **없음**.

---

## C. 사람 실행 절차 (종단 확인 — 에이전트 미실행 영역)

> 새 워크스페이스 `apps/design`는 `node_modules` 미설치 상태다. 아래는 **사람이** 직접 수행한다.

### C.0 전제
- **provider/모델 설정 필요.** 디자인 런은 기본 모델 `auto:chat`(`design-runs-api.ts:168`)로 실행. 사용 가능한 provider 인증/모델이 없으면 `error`→`done{failed}`로 끝남. 평소 chat 앱이 동작하는 인증 상태인지 먼저 확인.
- 포트: server **4873**, design **4878**(`kill-dev-ports.mjs:5`에 4878 등록됨).

### C.1 의존성 설치 (lockfile 주의)
```bash
! cd /Users/jikime/Dev/Business/Projects/passive-income/pie-lab
! npm install --package-lock-only --ignore-scripts   # lockfile diff 먼저 확인
! PI_ALLOW_LOCKFILE_CHANGE=1 npm install              # 커밋 의사 있을 때 실제 설치
```
- `apps/design` 의존은 모두 레포 기존 버전(새 외부 의존 0). lockfile diff가 워크스페이스 신규 항목 위주여야 정상.

### C.2 기동 (택1)
```bash
! npm run dev      # 옵션 A: concurrently로 server(4873)+design(4878) 동시
```
```bash
! cd apps/server && npm run dev    # 옵션 B(개별): http://127.0.0.1:4873
! cd apps/design && npm run dev    #              http://127.0.0.1:4878
```

### C.3 브라우저 조작·기대 화면
1. `http://127.0.0.1:4878` → "Pie Design Studio", 좌측 컴포저, 우측 미리보기 빈 상태.
2. **옵션 로드**: 스킬 `Single-page HTML`, 디자인 시스템 `지정 안 함 / Minimal / Vibrant`. (안 뜨면 "옵션 로드 실패" 배너 → server 미기동/인증 문제.)
3. Brief 예: `SaaS 랜딩 페이지 — 히어로, 기능 3개, 가격표, 푸터`, 디자인 시스템 `Minimal` → **실행**(⌘/Ctrl+Enter).
4. **스트림**: "실행 중 · running" → "writing index.html", 텍스트 점진 표시, 우측 "생성 중" 배지 → 완료 시 iframe 렌더.
5. **완료**: phase "완료", 미리보기·바이트 크기·**새 탭**/**다운로드** 활성. 다운로드 → `index.html` 첨부.
6. **중지 테스트**: 실행 직후 **중지** → phase "중지됨", hang 없음.
7. **(B-1 회귀 관찰)** 미리보기가 "생성 중"에서 멈추고 done에 아티팩트 미표시면 B-1 발현 → 브리지 회신. (보강으로 닫힌 경로이나 종단에서 최종 확인.)

### C.4 인증 없는 환경
- provider 키 없으면 RunStream에 `error`(모델 미인증/미해결) 후 phase "실패". UI는 깨지지 않고 에러 표면화 → 정상 degrade.

---

## D. 최종 판정

| 구분 | 판정 |
|---|---|
| 계약·정적/타입·견고성·원본대조 (에이전트 검증 가능 범위) | **사용 가능** — `npm run check` 통과, 웹↔서버 계약 1:1, 에이전트 타입 사용 정확, B-1 해결, 핵심 루프 단계 누락 없음. |
| 종단 동작(브라우저 + 실제 pie agent 런) | **사람 승인 필요** — `npm run dev` 미실행(AGENTS.md). C절 절차로 사람 확인. provider 인증 전제. |
| 미검증 영역 | `next build`(풀빌드)·실제 모델 런·다운로드 첨부 헤더 브라우저 거동은 종단 실행에서만 확정. (B-1 발현 경로는 정독+empirical로 닫힘 확인했고, 종단은 회귀 관찰만.) |

### 커밋 전 권고
- **차단 결함: 없음.** 계약/경계면 위반 0, 정적·타입 0 경고, B-1 해결.
- C.1 lockfile 변경은 사람이 diff 확인 후 커밋.

---

## E. B-1 재검증 (브리지 보강 후, 2026-06-19)

> 변경 범위: `apps/server/src/design-runs-api.ts` 내부만. `DesignStreamEvent`/`ArtifactDescriptor` 등 **계약 이벤트 필드 무변경**(enqueue 호출 14곳 전부 기존 유니온 형태 유지, `design-runs-api.ts:393-558`) → 웹·프론트 불변. `apps/design` 무접근.

### E-1. `toolCallId` 연결 키 정당성 (확인 1)
- **확인**: `tool_execution_start`와 `tool_execution_end`는 동일 tool call에 대해 같은 id를 쓴다.
  - start: `toolCallId: toolCall.id` (`packages/agent/src/agent-loop.ts:408-409`, parallel 경로 `:463-464`).
  - end: `toolCallId: finalized.toolCall.id` (`agent-loop.ts:719-720`), 여기서 `finalized.toolCall === toolCall`(같은 루프 변수).
  - serial(`executeToolCallsSerial`)·parallel 두 실행기 모두 start→…→end를 동일 `toolCall` 기준으로 emit.
- **판정**: 연결 키 **정당**. `pendingWrites.set(event.toolCallId, name)`(`design-runs-api.ts:511`) ↔ `pendingWrites.get(event.toolCallId)`(`:541`)가 같은 write를 정확히 매칭.

### E-2. 새 정규식 양쪽 케이스 검증 (확인 2)
- fallback 정규식 `/wrote\s+\d+\s+bytes\s+to\s+(\S+)/i`(`design-runs-api.ts:684`) + 트레일링 `.` 제거(`:687`) + `validatedArtifactName`(`:692-697`)를 **실행으로 확인**:
  | 입력 | 캡처→`.replace(/\.$/,"")`→basename | 검증 결과 |
  |---|---|---|
  | `Successfully wrote 1234 bytes to index.html.` | `index.html` | 통과 |
  | `... to index.html. Auto-stripped hashline display prefixes before writing.` | `index.html`(note는 `\S+` 경계에서 잘림) | 통과 — **note 경로 닫힘** |
  | `... to ./out/index.html.` | `index.html` | 통과 |
- 핵심: `(\S+)`가 공백에서 멈춰 path 토큰만 캡처 → 뒤따르는 note 문장이 캡처에 섞이지 않음. 구 `(.+?)\.?$`의 "end-anchor까지 흡수" 문제 제거.
- **판정**: `"wrote N bytes to index.html"` 및 note 부착본 **양쪽에서 올바른 `index.html`** 산출. **B-1 발현 경로 닫힘.**

### E-3. 1순위·fallback 검증 일관성 + map 누수 (확인 3)
- **1순위 경로**: `pendingName`은 `artifactNameFromArgs`(`:667-672`)에서 이미 `validatedArtifactName` 통과한 값 → start 단계에서 사전 검증됨.
- **fallback 경로**: `artifactNameFromResult`(`:681-689`)도 동일 `validatedArtifactName` 통과. → 두 경로 모두 whitelist + `.html` 보장. `name = pendingName ?? artifactNameFromResult(...)`(`:549`)는 일관.
- **map 누수**: `pendingWrites.delete(event.toolCallId)`(`:542`)가 **isError 분기 이전·무조건** 실행 → 성공·에러·키부재(no-op delete) 모두 정리. 잔여 가능성은 write 중 abort로 end 미도달인 경우뿐인데, `RunRecord`(`pendingWrites` 포함)는 per-run 인메모리라 런 종료 시 통째 폐기 → **크로스런 누수 없음**.
- **판정**: 검증 일관·누수 없음.

### E-4. `npm run check` + 계약 불변 (확인 4)
- 보강 후 재실행: biome 733 파일 0 경고, tsgo `--noEmit` 0 오류, browser-smoke 완료 (= **브리지 보고와 일치**).
- 계약 이벤트 필드·`ArtifactDescriptor`(`design-runs-api.ts:84-91`) 무변경 확인 → 프론트(`design-protocol.ts`/`ArtifactPreview.tsx`/`page.tsx`) 불변.
- **판정**: 정적/타입 green, 계약·프론트 불변.

### E-5. B-1 종합
- **B-1 닫힘: 예.** 1순위 `args.path`(검증된 basename) + 강화된 fallback + 무조건 map 정리. 잔여 차단 결함 없음.
- (참고·비차단) `validatedArtifactName`은 `.html`(빈 stem 점파일)도 형식상 통과하나, 실제 write path basename에서 정상 `index.html`로 귀결되므로 핵심 루프 영향 없음.
