# 구현 이력

이 문서는 `pie-lab` 통합 작업 중 실제 코드에 반영된 내용을 시간순으로 기록합니다.

## 2026-05-22: pi 기반 저장소 구성

완료한 일:

- `pie-lab` repository를 `pi` 소스 기반으로 구성했습니다.
- `apps/`와 `packages/router`, `packages/storage`, `packages/chat`, `packages/shared` 구조를 추가했습니다.
- `pi`, `9router`, `pie-chat` fork remote를 등록했습니다.
- `docs/`에 비전, 아키텍처, 마이그레이션 계획, 로드맵, 사용량 측정 원칙, 현재 결정 사항을 정리했습니다.

핵심 결정:

- `pie-lab`은 `pi-core에 9router를 내장한 통합 ADK`로 설계합니다.
- 실제 구현은 `pi` 소스를 그대로 기반으로 두고, `9router`와 `pie-chat` 기능을 역할별 패키지로 흡수합니다.
- `9router` executor를 그대로 우회 호출하지 않고, `pi` provider engine 앞에 router layer를 둡니다.

## 2026-05-22: router 1차 구현

완료한 일:

- `packages/router`에 model selection parser를 구현했습니다.
- `fixed`, `router`, `fallback` 세 가지 routing mode를 코드로 고정했습니다.
- `auto:coding`, `cheap:coding`, `fast:chat`, `combo:coding` 같은 alias 규칙을 추가했습니다.
- `resolveRoute()`가 `requestedModel`, `routingMode`, `resolvedProvider`, `resolvedModel`을 반환하도록 했습니다.
- pi `Model` catalog를 받아 실제 실행 모델로 변환하는 `resolvePiModelRoute()`를 구현했습니다.
- `coding-agent`의 일반 LLM 호출 경계인 `streamFn` 앞에 router resolve를 연결했습니다.
- `branch summary` 기본 호출도 router resolve 후 실제 모델로 호출하도록 연결했습니다.
- `ModelRegistry`에 `pie-lab-router` 가상 provider와 router alias 모델을 노출했습니다.

검증:

```bash
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts
npx tsgo --noEmit
```

당시 한계:

- `combo:coding`은 아직 실제 다단계 fallback attempt를 실행하지 않습니다.
- account round-robin, cooldown, quota/rate-limit은 아직 연결되지 않았습니다.
- usage/cost 저장은 아직 router 결과와 연결되지 않았습니다.
- 외부 `/v1` server endpoint는 아직 구현 전입니다.

다음 작업으로 잡은 것:

- router가 한 개의 모델만 반환하는 것을 넘어, fallback/ combo 시도 목록을 계산하도록 확장합니다.
- 이후 streaming 실행부에서 이 목록을 순서대로 시도할 수 있게 연결합니다.

## 2026-05-22: route plan 구현

완료한 일:

- `resolvePiModelRoutePlan()`을 추가했습니다.
- `combo:coding` 같은 router alias가 여러 모델 후보를 순서대로 route plan으로 만들 수 있게 했습니다.
- structured fallback selection의 `primary + fallback[]`도 route plan으로 만들 수 있게 했습니다.
- 중복 route 후보는 제거하고, catalog에서 찾을 수 없는 후보는 건너뛰도록 했습니다.
- 기존 `resolvePiModelRoute()`는 route plan의 첫 번째 후보를 반환하도록 정리했습니다.

예:

```ts
const plan = await resolvePiModelRoutePlan({
  requestedModel: "combo:coding",
  catalog,
  policy: {
    aliases: {
      "combo:coding": [
        "openai/gpt-5.4",
        "anthropic/claude-sonnet-4.5",
        "google/gemini-flash"
      ]
    }
  }
});
```

결과 형태:

```txt
plan.primary = 첫 번째 실행 후보
plan.routes  = fallback 실행 후보 목록
```

검증:

```bash
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts
npx tsgo --noEmit
```

당시 한계:

- route plan은 “무엇을 어떤 순서로 시도할지”만 계산합니다.
- 실제 streaming 실행 중 첫 번째 모델이 실패했을 때 다음 모델로 이어 붙이는 executor는 아직 구현 전입니다.

## 2026-05-22: route plan 기반 streaming fallback 1차 구현

완료한 일:

- `combo:*` alias가 별도 policy 없이도 기본 상위 후보 3개를 route plan으로 만들도록 확장했습니다.
- `coding-agent`의 SDK `streamFn`이 `resolvePiModelRoutePlan()` 결과를 순서대로 시도하도록 바꿨습니다.
- 첫 후보가 auth 오류, provider 호출 생성 오류, 또는 stream 시작 전 error event로 실패하면 다음 후보로 넘어가게 했습니다.
- 이미 `start`, `text_delta`, `toolcall_*` 같은 사용자에게 보이는 stream event가 나간 뒤의 오류는 중간 모델 전환을 하지 않고 그대로 전파합니다.
- `coding-agent` vitest 설정에 `@pie-lab/tui` source alias를 추가해 workspace build 없이 관련 테스트를 실행할 수 있게 했습니다.

검증:

```bash
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/coding-agent test -- sdk-openrouter-attribution.test.ts sdk-router-fallback.test.ts model-registry.test.ts
npx tsgo --noEmit
```

당시 한계:

- fallback attempt의 성공/실패를 아직 usage/cost 저장소에 기록하지 않습니다.
- account round-robin, cooldown, quota/rate-limit 기반 후보 제외는 아직 연결되지 않았습니다.
- stream이 이미 사용자에게 일부 출력된 뒤 실패하는 경우에는 transcript 일관성을 위해 다음 모델로 이어 붙이지 않습니다.

## 2026-05-22: fallback attempt usage 저장 1차 구현

완료한 일:

- `@pie-lab/storage`에 `UsageRecord`, `UsageStore`, `InMemoryUsageStore`, `JsonlUsageStore`를 추가했습니다.
- `UsageRecord`에 `requestId`, `attemptIndex`, `attemptCount`, `requestedModel`, `routingMode`, `resolvedProvider`, `resolvedModel`, `status`, `usage`, `cost`를 담도록 했습니다.
- `coding-agent` SDK의 routed stream 경로에서 각 route attempt의 성공/실패/중단 결과를 usage store에 기록하도록 연결했습니다.
- 기본 usage store는 `agentDir/usage.jsonl`에 JSONL로 저장합니다.
- 테스트에서는 `createInMemoryUsageStore()`로 fallback 실패 attempt와 성공 attempt가 모두 기록되는지 확인합니다.
- `@pie-lab/storage`도 빌드 대상 package로 정리하고 root build/dev 흐름에 포함했습니다.

검증:

```bash
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/coding-agent test -- sdk-router-fallback.test.ts sdk-openrouter-attribution.test.ts model-registry.test.ts
npx tsgo --noEmit
```

당시 한계:

- usage record는 JSONL로 쌓이지만 dashboard/API에서 조회하는 endpoint는 아직 없습니다.
- account selection, quota/rate-limit 정책은 아직 usage record를 읽어 후보 선택에 반영하지 않습니다.
- compaction 등 일부 보조 LLM 호출은 아직 동일한 usage record 흐름으로 완전히 들어오지 않았습니다.

## 2026-05-22: usage 조회 API 1차 구현

완료한 일:

- `@pie-lab/storage`에 usage record 필터링과 요약 집계 유틸을 추가했습니다.
- `queryUsageRecords()`로 provider, model, status, routingMode, requestId, agentRunId, endpoint, 기간, limit, 정렬 조건을 처리할 수 있게 했습니다.
- `summarizeUsageRecords()`로 전체 사용량과 provider/model별 token, cost, status 집계를 만들 수 있게 했습니다.
- `@pie-lab/server`에 실제 Node HTTP 서버를 추가했습니다.
- `GET /health`로 서버 상태를 확인할 수 있게 했습니다.
- `GET /usage`, `GET /v1/usage`로 최근 usage record를 조회할 수 있게 했습니다.
- `GET /usage/summary`, `GET /v1/usage/summary`로 usage summary를 조회할 수 있게 했습니다.
- 기본 usage file 경로는 `PIE_LAB_USAGE_PATH`가 있으면 그 값을 사용하고, 없으면 `PIE_CODING_AGENT_DIR/usage.jsonl`, 그것도 없으면 `~/.pie/agent/usage.jsonl`을 사용합니다.
- root build/dev 흐름에 `apps/server`를 포함했습니다.

검증:

```bash
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npx tsgo --noEmit
```

당시 한계:

- 외부 `/v1/chat/completions` adapter는 아직 구현 전입니다.
- dashboard는 아직 usage API를 읽지 않습니다.
- account selection, quota/rate-limit 정책은 아직 usage summary를 후보 선택에 반영하지 않습니다.

## 2026-05-22: dashboard usage 화면 1차 구현

완료한 일:

- `apps/dashboard`를 Vite 기반 브라우저 앱으로 전환했습니다.
- usage summary card, provider/model 집계 목록, 최근 usage record table을 추가했습니다.
- status, provider, model, limit, 정렬 조건으로 usage record를 조회할 수 있게 했습니다.
- dashboard는 `@pie-lab/server`의 `GET /usage`, `GET /usage/summary`를 읽습니다.
- 기본 연결 주소는 `http://127.0.0.1:4873`입니다.
- dashboard dev server는 기본 `http://127.0.0.1:4874`에서 실행됩니다.
- root build/dev 흐름에 `apps/dashboard`를 포함했습니다.

검증:

```bash
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
npx tsgo --noEmit
```

당시 한계:

- provider 등록, quota, routing policy 편집 화면은 아직 없습니다.
- request detail drawer와 fallback timeline은 아직 없습니다.
- `/v1/chat/completions` 외부 호출이 아직 구현 전이라 dashboard는 내부 routed stream usage를 우선 확인합니다.

## 2026-05-22: OpenAI-compatible chat completions 1차 구현

완료한 일:

- `apps/server`에 `POST /v1/chat/completions` 최소 adapter를 추가했습니다.
- `apps/server`에 `GET /v1/models`, `GET /models` model list endpoint를 추가했습니다.
- 외부 요청의 `model` 값을 `@pie-lab/router`의 `resolvePiModelRoutePlan()`으로 해석하도록 했습니다.
- `auto:coding`, `combo:coding`, `fixed:*`, `fallback:*`, `provider/model` 요청이 같은 router path를 거칩니다.
- OpenAI chat messages를 pi `Context`로 변환한 뒤 `@pie-lab/ai`의 `completeSimple()`로 호출합니다.
- route attempt 결과를 `@pie-lab/storage`의 `UsageStore`에 저장합니다.
- route attempt가 `error`나 `aborted`로 끝나면 다음 route 후보를 시도합니다.
- 성공 응답에는 OpenAI-compatible `choices`, `usage`와 함께 `pi_adk` routing metadata를 포함합니다.
- 테스트에서는 실제 LLM 호출 없이 executor를 주입해 routing, fallback attempt, usage record 저장을 검증합니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/ai run build
npm --workspace @pie-lab/server run build
npx tsgo --noEmit
```

당시 한계:

- `stream: true` SSE 응답은 아직 구현 전이며, 현재는 `501 not_implemented_error`를 반환합니다.
- provider API key 선택은 아직 coding-agent의 `ModelRegistry`/auth storage와 통합되지 않았고, pi-ai provider의 기본 환경변수 흐름에 의존합니다.
- tools는 provider에 전달할 수 있지만, server가 tool execution loop를 직접 수행하지는 않습니다.
- account selection, quota/rate-limit 기반 route 제외는 아직 남아 있습니다.

## 2026-05-23: Next.js 16 기반 dashboard-next 1차 구성

완료한 일:

- `apps/dashboard-next`를 `npx create-next-app@latest`로 생성했습니다.
- Next.js `16.2.6`, React `19.2.4`, Tailwind CSS 4 기반으로 구성했습니다.
- `npx shadcn@latest init`으로 shadcn/ui를 초기화했습니다.
- `button`, `card`, `badge`, `table`, `tabs`, `input`, `select`, `textarea`, `dialog`, `sheet`, `dropdown-menu`, `tooltip`, `separator`, `scroll-area`, `skeleton`, `progress`, `alert`, `switch`, `label` 컴포넌트를 추가했습니다.
- 기존 Vite 대시보드는 그대로 두고, 새 대시보드는 `@pie-lab/dashboard-next` workspace로 분리했습니다.
- 9router 원본의 메뉴형 대시보드 구조를 참고해 다음 페이지를 만들었습니다.
  - Overview
  - Routing
  - Providers
  - Usage
  - Quota
  - Media
  - Proxy
  - Logs
  - Settings
- 브라우저에서 기존 `apps/server` API를 호출하는 `src/lib/api-client.ts`를 추가했습니다.
- 대시보드 shell, sidebar, header, page header, metric card, table wrapper, loading/error state를 공통 컴포넌트로 분리했습니다.
- 새 dashboard dev server는 기존 Vite dashboard와 충돌하지 않도록 `http://127.0.0.1:4876`에서 실행합니다.
- API 기본 주소는 `NEXT_PUBLIC_PIE_API_BASE_URL`이 없으면 `http://127.0.0.1:4873`을 사용합니다.

검증:

```bash
npm --workspace @pie-lab/dashboard-next run lint
npm --workspace @pie-lab/dashboard-next run build
```

브라우저 확인:

- `http://127.0.0.1:4876/`
- `http://127.0.0.1:4876/routing`

확인 결과:

- Next.js 페이지 title은 `Pie Lab Dashboard`로 표시됩니다.
- 사이드바 메뉴는 `Overview`, `Routing`, `Providers`, `Usage`, `Quota`, `Media`, `Proxy`, `Logs`, `Settings`로 렌더링됩니다.
- 브라우저 콘솔 error/warning은 없습니다.

당시 한계:

- 기존 `apps/dashboard`의 모든 편집 기능을 아직 완전히 대체하지는 않습니다.
- provider OAuth wizard, request detail trace viewer, quota detail drawer 같은 고급 UI는 이후 단계에서 Next.js 화면으로 옮깁니다.
- root `build` script에는 아직 `dashboard-next`를 기본 포함하지 않았습니다. 기존 Vite 대시보드를 안정적으로 유지하면서 단계적으로 교체하기 위한 결정입니다.

## 2026-05-22: OpenAI-compatible streaming/SSE 1차 구현

완료한 일:

- `POST /v1/chat/completions`에서 `stream: true` 요청을 SSE로 응답하도록 구현했습니다.
- pi `AssistantMessageEvent`의 `text_delta`를 OpenAI-compatible `chat.completion.chunk`로 변환합니다.
- stream 완료 시 final chunk와 `data: [DONE]`을 전송합니다.
- stream 성공/오류/중단 attempt를 `UsageStore`에 기록합니다.
- stream 시작 전, 즉 아직 SSE chunk를 하나도 보내지 않은 실패는 다음 route 후보로 fallback합니다.
- SSE chunk가 이미 나간 뒤의 오류는 transcript 일관성을 위해 다른 모델로 넘어가지 않고 error SSE를 보낸 뒤 종료합니다.
- tool call은 1차 구현에서 `toolcall_end` 시점에 OpenAI-compatible `tool_calls` chunk로 변환합니다.
- 테스트에서 streaming chunk 변환, usage 저장, stream 시작 전 fallback 동작을 검증했습니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/dashboard run build
npx tsgo --noEmit
```

현재 한계:

- OpenAI streaming의 `stream_options.include_usage` 호환은 아직 구현하지 않았습니다.
- tool call argument를 token 단위로 점진 streaming하지 않고, 현재는 `toolcall_end`에서 완성본을 보냅니다.
- provider API key 선택은 아직 coding-agent의 `ModelRegistry`/auth storage와 통합되지 않았습니다.
- account selection, quota/rate-limit 기반 route 제외는 아직 남아 있습니다.

## 2026-05-22: server auth/model registry 통합 1차 구현

완료한 일:

- `apps/server`의 기본 model catalog를 `coding-agent`의 `ModelRegistry` 기반으로 바꿨습니다.
- `ModelRegistry`는 `~/.pie/agent/models.json`과 `~/.pie/agent/auth.json`을 기본으로 읽습니다.
- `PIE_CODING_AGENT_DIR`가 설정되어 있으면 해당 agent dir의 `models.json`, `auth.json`을 사용합니다.
- 외부 `/v1/chat/completions` 호출 전에 `ModelRegistry.getApiKeyAndHeaders()`를 실행해 provider API key와 custom headers를 가져옵니다.
- 가져온 `apiKey`, `headers`를 `completeSimple()`과 `streamSimple()` 옵션에 주입합니다.
- `coding-agent` package에 서버가 무거운 root export를 거치지 않도록 subpath export를 추가했습니다.
  - `@pie-lab/coding-agent/auth-storage`
  - `@pie-lab/coding-agent/model-registry`
  - `@pie-lab/coding-agent/config`
- 테스트에서 auth resolver가 executor 옵션에 `apiKey`, `headers`를 주입하는지 검증했습니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/tui run build
npm --workspace @pie-lab/agent-core run build
npm --workspace @pie-lab/coding-agent run build
npx tsgo --noEmit
```

현재 한계:

- account selection, quota/rate-limit 기반 route 제외는 아직 남아 있습니다.
- dashboard에서 auth/provider 상태를 보여주는 화면은 아직 없습니다.
- team/user별 API key 분리는 아직 없습니다.

## 2026-05-22: provider/auth 상태 API와 dashboard 1차 구현

완료한 일:

- `apps/server`에 provider/auth 상태 조회 API를 추가했습니다.
- `GET /providers`, `GET /v1/providers`를 지원합니다.
- 응답에는 provider id/name, 인증 설정 여부, auth source/label, 전체 model 수, 사용 가능한 model 수를 포함합니다.
- provider 상태는 `coding-agent`의 `ModelRegistry.getProviderAuthStatus()`와 `getProviderDisplayName()` 기준으로 계산합니다.
- dashboard에 `Provider 인증` 표를 추가했습니다.
- dashboard는 `/providers`를 읽어 provider별 설정 여부와 model 수를 보여줍니다.
- provider status API 단위 테스트를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/router test
npx tsgo --noEmit
```

현재 한계:

- dashboard에서 provider를 추가하거나 로그인하는 동작은 아직 없습니다.
- provider별 quota/rate-limit, cooldown 상태는 아직 표시하지 않습니다.
- account가 여러 개인 경우의 account selection 상태는 아직 없습니다.

## 2026-05-22: 9router 원본 combo/account fallback primitive 반영

완료한 일:

- `router-fork/master`를 fetch해서 실제 9router 소스를 확인했습니다.
- 9router의 모델 라우팅 기준이 임의 점수 계산이 아니라 `combo`, `fallback`, `round-robin`, `account cooldown`, `quota/rate-limit` 중심이라는 점을 문서에 반영했습니다.
- `packages/router`에 9router 원본 `open-sse/services/combo.js` 기준 기능을 TypeScript로 옮겼습니다.
  - named combo 해석
  - combo fallback 순서 유지
  - combo round-robin
  - sticky round-robin
  - combo rotation reset
- `packages/router`에 9router 원본 `open-sse/services/accountFallback.js` 기준 기능을 TypeScript로 옮겼습니다.
  - `checkFallbackError()`
  - `getQuotaCooldown()`
  - `filterAvailableAccounts()`
  - `isModelLockActive()`
  - `modelLock_${model}` helper
  - account error/reset state helper
- 테스트에 named combo, round-robin sticky limit, rate-limit/quota cooldown, account filter 검증을 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
```

중요한 정정:

- 앞으로 router 판단 기준은 임의 scoring을 늘리는 방식으로 가지 않습니다.
- 9router 원본처럼 사용자가 정의한 combo와 provider/account 상태를 기준으로 라우팅합니다.
- `auto:coding`, `cheap:coding`, `fast:chat` alias는 당장 호환을 위해 남아 있지만, 운영 기준은 9router-style named combo로 옮기는 것이 맞습니다.

현재 한계:

- account fallback primitive는 이후 실제 `coding-agent` provider 호출 전 account selection에 연결했습니다.
- provider connection store는 9router의 SQLite 구조를 그대로 들여오지 않고, `pi`의 `ModelRegistry/AuthStorage` 흐름에 맞춘 JSON store로 연결했습니다.
- quota fetcher와 dashboard quota 상태 표시는 이후 1차 API/상태 표까지 연결했고, OAuth refresh와 proxy-aware fetch도 quota 상세 API에 1차 연결했습니다.
- proxy pool store와 quota API의 proxy pool 해석도 이후 1차 연결했습니다. proxy pool 관리 API/dashboard와 상세 dashboard 고도화는 아직 남아 있습니다.

## 2026-05-22: 9router fallback 판단 규칙 실행 경로 연결

완료한 일:

- 외부 `POST /v1/chat/completions` non-stream 경로에서 route attempt 실패 시 `checkFallbackError()`를 사용하도록 연결했습니다.
- 외부 `POST /v1/chat/completions` streaming 경로에서 SSE chunk가 나가기 전 실패한 경우 `checkFallbackError()`로 다음 후보 시도 여부를 판단하게 했습니다.
- 내부 `coding-agent` `streamFn` 경로에서도 stream 시작 전 실패 시 `checkFallbackError()`를 사용하도록 연결했습니다.
- upstream error object에 `status`, `statusCode`, `code`, `response.status`가 있으면 usage record의 `errorCode`로 저장합니다.
- 서버 테스트에 HTTP 429 `too many requests`가 9router fallback 규칙을 통해 다음 route 후보로 넘어가는 케이스를 추가했습니다.
- router의 error normalization이 `Error` 객체의 `message`를 읽도록 보완했습니다.

검증:

```bash
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/coding-agent test -- sdk-router-fallback.test.ts
npx tsgo --noEmit
```

중요한 기준:

- fallback 판단은 임의 규칙이 아니라 9router 원본의 `ERROR_RULES`, exponential backoff, transient cooldown 규칙을 기준으로 합니다.
- 아직 cooldown 결과를 영구 provider/account 상태에 저장하지는 않습니다.
- 다음 단계는 9router의 provider connection store와 account selection 전략을 `pie-lab`에 맞게 연결하는 것입니다.

## 2026-05-22: 9router provider connection/account selection 1차 구현

완료한 일:

- 9router 원본 `src/lib/db/repos/connectionsRepo.js`, `src/lib/db/repos/settingsRepo.js`, `src/sse/services/auth.js`를 기준으로 필요한 구조를 확인했습니다.
- `@pie-lab/storage`에 provider connection/settings store를 추가했습니다.
  - `ProviderConnection`
  - `ProviderConnectionSettings`
  - `ProviderConnectionStore`
  - `InMemoryProviderConnectionStore`
  - `JsonProviderConnectionStore`
- provider connection은 9router처럼 provider, authType, priority, isActive, apiKey/accessToken, providerSpecificData, lastUsedAt, consecutiveUseCount, error/backoff/modelLock 계열 필드를 담을 수 있게 했습니다.
- provider connection 조회는 9router 원본처럼 `priority || 999` 기준으로 정렬합니다.
- settings에는 9router의 account fallback 전략과 같은 `fallbackStrategy`, `stickyRoundRobinLimit`, `providerStrategies`를 저장합니다.
- `@pie-lab/router`에 9router `getProviderCredentials()`의 account 선택 부분을 순수 함수로 옮겼습니다.
  - provider별 active connection 필터링
  - `preferredConnectionId` 우선 선택
  - `fill-first` 선택
  - `round-robin` 선택
  - sticky round-robin count 업데이트값 계산
  - `modelLock_${model}`로 잠긴 계정 제외
  - 모든 계정이 잠겼을 때 retryAfter/retryAfterHuman 반환
- storage/router 테스트에 provider connection 저장, settings 저장, fill-first, preferred account, sticky round-robin, modelLock unavailable 케이스를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
```

중요한 기준:

- 이번 구현은 임의 routing score를 추가한 것이 아니라, 9router 원본의 provider connection/settings/account selection 흐름을 `pie-lab` 패키지 경계에 맞게 나눈 것입니다.
- router helper는 아직 직접 저장소를 수정하지 않고, 선택 결과와 `lastUsedAt/consecutiveUseCount` 업데이트값만 반환합니다.
- 다음 단계는 이 helper를 실제 `ModelRegistry/AuthStorage` 인증 선택 직전에 연결하고, 실패 시 `modelLock_${model}` 업데이트를 provider connection store에 저장하는 것입니다.

## 2026-05-22: provider connection 용어 정리와 인증 선택 연결

정리한 내용:

- 9router의 routing/fallback 문맥에서 말하는 `account`는 회원가입 계정이 아니라 provider 인증 연결입니다.
- `pie-lab`에서는 혼동을 줄이기 위해 `provider connection`, `인증 연결`, `connectionId` 용어를 우선 사용합니다.
- dashboard 접근 보안용 로그인(`requireLogin`, `authMode`, OIDC)과 LLM provider connection은 별개 개념입니다.

완료한 일:

- `ModelRegistry`에 optional `ProviderConnectionStore`를 연결할 수 있게 했습니다.
- `ModelRegistry.getApiKeyAndHeaders()`가 provider connection store가 있을 때 다음 순서로 인증을 해석합니다.
  1. provider/model에 맞는 active provider connection 조회
  2. `selectProviderConnection()`으로 fill-first 또는 round-robin 선택
  3. 선택된 connection의 `apiKey` 또는 `accessToken` 사용
  4. round-robin 업데이트값이 있으면 connection의 `lastUsedAt`, `consecutiveUseCount` 저장
  5. 반환값에 `connectionId` 포함
- 기본 server와 coding-agent SDK 생성 경로에서 `agentDir/provider-connections.json`을 provider connection store로 사용하도록 연결했습니다.
- 외부 `/v1/chat/completions` usage record와 내부 coding-agent routed stream usage record가 auth resolver에서 받은 `connectionId`를 저장할 수 있게 했습니다.
- 테스트에 provider connection 우선 인증 선택, round-robin 상태 업데이트, server usage record의 `connectionId` 저장 케이스를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts
npm --workspace @pie-lab/server test -- chat-completions-api.test.ts
```

현재 한계:

- 기존 `auth.json`의 provider별 단일 인증 정보를 `provider-connections.json`으로 자동 변환하지는 않습니다.
- provider connection store만으로 `getAvailable()`의 동기 availability 판단을 완전히 대체하지는 않습니다.
- 실패한 provider connection에 `modelLock_${model}`을 저장하는 작업은 아직 남아 있습니다.

## 2026-05-22: auth.json -> provider connection 온디맨드 동기화

완료한 일:

- 기존 pi 사용자가 `auth.json`에 저장한 인증 정보를 다시 입력하지 않아도 provider connection 흐름에 들어올 수 있게 했습니다.
- `ModelRegistry.getApiKeyAndHeaders()`에서 해당 provider의 active provider connection이 하나도 없으면 `authStorage.get(provider)`를 확인합니다.
- 저장된 인증이 API key이면 `provider-connections.json`에 `authType: "apikey"` connection을 생성합니다.
- 저장된 인증이 OAuth이면 `provider-connections.json`에 `authType: "oauth"` connection을 생성합니다.
- OAuth connection은 실제 API key 해석 시 기존 `AuthStorage.getApiKey()`를 다시 사용합니다. 따라서 기존 pi의 OAuth refresh 흐름을 유지합니다.
- 생성된 connection에는 `providerSpecificData.source = "auth.json"`을 남겨 출처를 구분합니다.
- 테스트에 API key 자동 생성, OAuth 자동 생성 케이스를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts
npx tsgo --noEmit
```

현재 한계:

- `auth.json`에서 로그아웃하거나 인증을 삭제했을 때 기존 provider connection을 자동 비활성화하지는 않습니다.
- provider connection이 이미 있으면 `auth.json`에서 추가 동기화를 하지 않습니다.
- 실패한 connection에 `modelLock_${model}`을 저장하는 작업은 아직 남아 있습니다.

## 2026-05-22: provider connection modelLock 저장 연결

완료한 일:

- 실패한 provider connection을 9router 방식의 `modelLock_${model}` 상태로 저장하도록 연결했습니다.
- `ModelRegistry.markProviderConnectionUnavailable()`을 추가해 provider 호출 실패 시 다음 정보를 provider connection에 저장합니다.
  - `modelLock_${model}`
  - `testStatus: "unavailable"`
  - `lastError`
  - `errorCode`
  - `lastErrorAt`
  - `backoffLevel`
- cooldown 판단은 임의 규칙이 아니라 `@pie-lab/router`의 9router-derived `checkFallbackError()`와 `buildModelLockUpdate()`를 사용합니다.
- `ModelRegistry.clearProviderConnectionError()`를 추가해 성공한 요청의 현재 모델 잠금과 만료된 잠금을 정리합니다.
- 외부 `POST /v1/chat/completions` non-stream/stream 경로와 내부 `coding-agent` routed stream 경로에서 실패/성공 결과를 provider connection 상태에 반영합니다.
- 잠긴 connection은 다음 인증 선택에서 `selectProviderConnection()`에 의해 제외됩니다.
- 테스트에 429 실패가 특정 connection의 `modelLock_${model}`을 만들고, 다음 connection으로 넘어간 뒤 성공 시 상태가 정리되는 케이스를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts sdk-router-fallback.test.ts
npm --workspace @pie-lab/server test
npx tsgo --noEmit
npm --workspace @pie-lab/coding-agent run build
npm --workspace @pie-lab/server run build
```

중요한 기준:

- 여기서 새로 만든 것은 pie-lab의 연결 코드입니다.
- fallback/cooldown 판단, modelLock key, provider connection 제외 방식은 9router에서 가져온 기능을 사용합니다.
- 이후 provider quota API와 dashboard 상태 표시는 1차 연결했습니다.
- 이후 quota 상세 dashboard는 수동 조회 방식으로 1차 연결했습니다.
- 이후 quota API의 OAuth refresh는 1차 연결했습니다.
- 이후 quota API의 proxy-aware fetch는 1차 연결했습니다.
- 이후 quota API의 proxy pool 해석도 1차 연결했습니다.
- 당시 남은 일은 proxy pool 관리 API/dashboard, provider connection에 proxy pool을 지정하는 흐름, quota 상세 dashboard 고도화, auth.json 삭제/로그아웃과 provider connection store의 양방향 정합성이었습니다.
- 이후 proxy pool 관리/지정과 auth.json 삭제/로그아웃 동기화는 1차 구현했습니다.

## 2026-05-22: 패키지 스코프를 @pie-lab로 정리

완료한 일:

- 기존 `@earendil-works/*` workspace package 이름을 `@pie-lab/*`로 변경했습니다.
- 변경한 주요 mapping은 다음과 같습니다.
  - `@earendil-works/pi-ai` -> `@pie-lab/ai`
  - `@earendil-works/pi-agent-core` -> `@pie-lab/agent-core`
  - `@earendil-works/pi-coding-agent` -> `@pie-lab/coding-agent`
  - `@earendil-works/pi-tui` -> `@pie-lab/tui`
  - `@earendil-works/pi-web-ui` -> `@pie-lab/web-ui`
- 코드 import, `package.json`, root `tsconfig` path alias, vitest alias, README/package docs, examples의 package reference를 새 스코프로 맞췄습니다.
- `npm install`을 다시 실행해 `node_modules/@pie-lab/*` workspace symlink와 `package-lock.json`을 갱신했습니다.
- 이제 사용자-facing workspace 명령은 `npm --workspace @pie-lab/coding-agent ...` 형태를 사용합니다.

검증:

```bash
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts sdk-router-fallback.test.ts config.test.ts package-command-paths.test.ts
npm --workspace @pie-lab/server test
npx tsgo --noEmit
npm --workspace @pie-lab/ai run build
npm --workspace @pie-lab/tui run build
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/agent-core run build
npm --workspace @pie-lab/web-ui run build
npm --workspace @pie-lab/coding-agent run build
npm --workspace @pie-lab/server run build
```

주의할 점:

- 이것은 프로젝트 정체성과 개발 명령 정리를 위한 mechanical rename입니다.
- 9router에서 가져온 routing/account 판단 로직 자체는 이번 rename으로 바뀌지 않았습니다.
- 과거 changelog나 fixture 안에 남은 예전 스코프 문자열은 역사적 기록 또는 테스트 fixture 성격이어서 실행 경로의 package reference와 구분합니다.

## 2026-05-22: 9router provider quota API 1차 연결

완료한 일:

- 9router 원본 `src/shared/constants/providers.js`, `src/lib/usage/fetcher.js`, `open-sse/services/usage.js`, `src/app/api/usage/[connectionId]/route.js`를 기준으로 usage/quota 조회 흐름을 확인했습니다.
- 9router 원본처럼 quota 조회 대상을 provider connection 단위로 잡았습니다.
- `apps/server`에 quota API를 추가했습니다.
  - `GET /quota`
  - `GET /v1/quota`
  - `GET /quota/:connectionId`
  - `GET /v1/quota/:connectionId`
- `GET /quota`는 connection 목록, provider, auth type, supported/eligible 여부를 반환합니다.
- `GET /quota/:connectionId`는 해당 connection의 provider별 usage/quota fetcher를 호출합니다.
- API 응답에서 `apiKey`, `accessToken`, `refreshToken`은 노출하지 않도록 connection summary만 반환합니다.
- 9router 원본의 지원 provider 목록을 기준으로 `USAGE_SUPPORTED_PROVIDERS`, `USAGE_APIKEY_PROVIDERS`를 반영했습니다.
- 1차 fetcher는 GitHub, Claude, Codex, GLM, MiniMax, Ollama 메시지 응답을 연결했습니다.
- MiniMax token plan과 coding plan의 count 의미 차이는 9router 원본 테스트와 같은 방식으로 검증했습니다.
- `/usage`는 pie-lab의 로컬 usage record API로 이미 사용 중이므로, provider quota 조회는 충돌을 피하기 위해 `/quota`로 분리했습니다.
- dashboard에 `Quota 연결` 표를 추가해 provider connection별 quota 조회 가능 여부를 표시합니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
npx tsgo --noEmit
```

현재 한계:

- OAuth connection의 refresh token 갱신과 proxy option 연결은 아직 9router 원본 수준으로 완전히 옮기지 않았습니다.
- 이 시점의 dashboard는 quota 조회 가능 여부만 표시하고, 실제 quota 상세값을 자동 호출하지는 않았습니다.
- 이 시점에는 Gemini CLI, Antigravity, Kiro, Kimi Coding의 고급 quota fetcher가 아직 pie-lab fetcher로 완전히 연결되지 않았습니다.
- 그 시점에는 quota 값을 account selection 우선순위에 반영하지 않았습니다.

중요한 기준:

- quota provider 목록, API key 허용 provider subset, MiniMax usage count 해석은 9router 원본을 기준으로 했습니다.
- `/quota` endpoint와 dashboard 표시 방식은 pie-lab의 기존 `/usage` record API와 충돌하지 않도록 만든 통합용 adapter입니다.

## 2026-05-22: dashboard quota 상세 수동 조회 1차 구현

완료한 일:

- dashboard의 `Quota 연결` 표에 connection별 `조회` 동작을 추가했습니다.
- 사용자가 누른 connection에 대해서만 `GET /quota/:connectionId`를 호출합니다.
- 응답의 `plan`, `resetDate`, `message`, `quotas`를 `Quota 상세` 영역에 표시합니다.
- quota별 used, remaining, total, reset time을 표 형태로 보여줍니다.
- 조회할 수 없는 connection은 버튼을 비활성화합니다.
- 전체 dashboard refresh와 quota 상세 조회의 abort controller를 분리했습니다.

검증:

```bash
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
npm --workspace @pie-lab/server test
npx tsgo --noEmit
```

중요한 기준:

- quota 상세값을 자동으로 전부 불러오지 않습니다.
- provider quota API는 실제 provider endpoint를 호출할 수 있으므로, 사용자가 선택한 connection만 조회합니다.
- 이 단계는 9router의 connection별 quota 조회 흐름을 dashboard에 연결한 것이고, quota 값으로 routing/account selection을 바꾸는 단계는 아직 아닙니다.

## 2026-05-22: Gemini CLI, Antigravity, Kiro quota fetcher 연결

완료한 일:

- 9router 원본 `open-sse/services/usage.js`의 provider별 usage fetcher를 기준으로 `apps/server` quota fetcher를 확장했습니다.
- `gemini-cli` quota 조회를 추가했습니다.
  - `providerSpecificData.projectId`가 있으면 그대로 사용합니다.
  - 없으면 `loadCodeAssist`로 project ID와 plan을 조회합니다.
  - `retrieveUserQuota`의 bucket별 `remainingFraction`을 normalized quota로 변환합니다.
- `antigravity` quota 조회를 추가했습니다.
  - `loadCodeAssist`로 subscription/project 정보를 조회합니다.
  - `fetchAvailableModels`에서 9router 원본과 같은 recommended model subset만 quota로 표시합니다.
- `kiro` quota 조회를 추가했습니다.
  - 9router 원본처럼 CodeWhisperer GET, CodeWhisperer POST, Q endpoint 순서로 시도합니다.
  - `usageBreakdownList`와 free trial quota를 공통 quota shape로 변환합니다.
- 테스트에 Gemini CLI bucket, Antigravity recommended model, Kiro usage limit 파싱 케이스를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npx tsgo --noEmit
```

중요한 기준:

- 이번 변경은 quota fetcher 확장입니다.
- provider 목록, Antigravity recommended model 필터, Kiro endpoint 시도 순서는 9router 원본을 기준으로 했습니다.
- 이후 OAuth token refresh는 1차 연결했습니다.
- 이후 proxy-aware fetch는 quota API에 1차 연결했습니다.
- 그 시점에는 quota 값을 routing/account selection 우선순위에 반영하지 않았습니다.

## 2026-05-22: quota API OAuth token refresh 1차 연결

완료한 일:

- 9router 원본 `src/app/api/usage/[connectionId]/route.js`의 `refreshAndUpdateCredentials()` 흐름을 기준으로 quota 상세 조회 전 token refresh 단계를 추가했습니다.
- OAuth connection은 quota 상세 조회 전에 token 만료 여부를 확인합니다.
- 만료가 임박했거나 GitHub Copilot token이 없으면 provider별 refresh endpoint를 호출합니다.
- refresh 결과의 `accessToken`, `refreshToken`, `expiresAt`, GitHub `copilotToken` 계열 값을 provider connection store에 저장합니다.
- quota fetcher가 인증 만료 메시지를 반환하면 9router 원본처럼 force refresh 후 한 번 더 quota 조회를 시도합니다.
- 지원한 refresh provider는 현재 quota 지원 범위에 맞춰 `claude`, `codex`, `gemini-cli`, `antigravity`, `github`, `kiro`, `kimi-coding`입니다.
- 테스트에 만료된 Gemini CLI OAuth token refresh, 인증 만료 응답 후 force refresh/retry 케이스를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npx tsgo --noEmit
```

중요한 기준:

- 이 단계는 quota 상세 조회의 인증 갱신만 다룹니다.
- provider별 refresh endpoint, client id/client secret, Kiro/GitHub/Kimi refresh 방식은 9router 원본을 기준으로 옮겼습니다.
- 이후 proxy-aware fetch는 quota API에 1차 연결했습니다.
- 그 시점에는 quota 값을 routing/account selection 우선순위에 반영하지 않았습니다.

## 2026-05-22: quota API proxy-aware fetch 1차 연결

완료한 일:

- 9router 원본 `open-sse/utils/proxyFetch.js`와 `src/lib/network/connectionProxy.js`를 기준으로 quota API용 proxy-aware fetch를 추가했습니다.
- provider connection의 `providerSpecificData`에 있는 legacy proxy 설정을 읽습니다.
  - `connectionProxyEnabled`
  - `connectionProxyUrl`
  - `connectionNoProxy`
  - `vercelRelayUrl`
- quota 상세 조회와 OAuth token refresh가 같은 proxy-aware fetch를 사용하도록 연결했습니다.
- Vercel relay 설정이 있으면 `x-relay-target`, `x-relay-path` header를 붙여 relay URL로 보냅니다.
- legacy proxy 설정이 있으면 `undici` `ProxyAgent` dispatcher를 붙입니다.
- 환경변수 proxy(`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`)도 반영합니다.
- 9router 원본처럼 Cloud Code, CodeWhisperer, Q 같은 host는 MITM DNS bypass 대상으로 처리합니다.
- quota/refresh 경로는 9router usage route와 같이 strict proxy를 기본 강제하지 않고, proxy 실패 시 직접 호출로 fallback합니다.
- 테스트에 Vercel relay proxy와 legacy connection proxy dispatcher 케이스를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npx tsgo --noEmit
```

현재 한계:

- 이 단계에서는 9router의 proxy pool DB까지는 아직 pie-lab storage에 옮기지 않았습니다.
- 이 단계에서는 provider connection의 legacy proxy field와 direct `vercelRelayUrl`만 읽었습니다.
- 그 시점에는 quota 값을 routing/account selection 우선순위에 반영하지 않았습니다.

## 2026-05-22: proxy pool store와 quota API 연동

완료한 일:

- 9router 원본 `src/lib/db/repos/proxyPoolsRepo.js`, `src/app/api/proxy-pools/route.js`, `src/lib/network/connectionProxy.js`, `src/app/api/usage/[connectionId]/route.js`를 기준으로 proxy pool 흐름을 확인했습니다.
- `@pie-lab/storage`의 provider connection JSON state에 `proxyPools`를 추가했습니다.
- 9router proxy pool 기본값을 맞췄습니다.
  - `type`: 기본 `http`, Vercel relay는 `vercel`
  - `isActive`: 기본 `true`
  - `strictProxy`: 명시적으로 `true`일 때만 true
  - `testStatus`: 기본 `unknown`
- `ProviderConnectionStore`가 proxy pool store 역할도 같이 하도록 다음 메서드를 추가했습니다.
  - `getProxyPools()`
  - `getProxyPoolById()`
  - `createProxyPool()`
  - `updateProxyPool()`
  - `deleteProxyPool()`
- quota API에서 `providerSpecificData.proxyPoolId`를 읽어 9router 원본과 같은 우선순위로 proxy 설정을 해석합니다.
  1. active proxy pool
  2. legacy connection proxy
  3. no proxy
- `proxyPoolId`가 `"__none__"`이면 9router처럼 proxy pool 선택을 비활성화합니다.
- proxy pool type이 `vercel`이면 relay URL로 보내고 `x-relay-target`, `x-relay-path` header를 붙입니다.
- 표준 `http` proxy pool이면 `undici` `ProxyAgent` dispatcher를 붙입니다.
- quota/refresh 경로는 9router usage route처럼 `strictProxy`를 강제하지 않고, proxy 실패 시 직접 호출 fallback을 허용합니다.

검증:

```bash
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npx tsgo --noEmit
```

현재 한계:

- 아직 proxy pool을 생성/수정/삭제하는 server API와 dashboard 화면은 없습니다.
- 아직 provider connection에 proxy pool을 지정하는 server API와 dashboard 화면은 없습니다.
- 그 시점에는 quota 값을 routing/account selection 우선순위에 반영하지 않았습니다.

## 2026-05-22: proxy pool 관리 API와 dashboard 지정 흐름 1차 구현

완료한 일:

- 9router 원본 `src/app/api/proxy-pools/route.js`, `src/app/api/proxy-pools/[id]/route.js`, `src/app/api/providers/[id]/route.js`를 기준으로 proxy pool 관리 흐름을 pie-lab server에 연결했습니다.
- `apps/server`에 proxy pool 관리 API를 추가했습니다.
  - `GET /proxy-pools`
  - `GET /v1/proxy-pools`
  - `POST /proxy-pools`
  - `GET /proxy-pools/:id`
  - `PUT /proxy-pools/:id`
  - `DELETE /proxy-pools/:id`
- `GET /proxy-pools?includeUsage=true`는 9router처럼 provider connection에 묶인 수를 `boundConnectionCount`로 함께 반환합니다.
- 사용 중인 proxy pool은 삭제하지 못하도록 `409`를 반환합니다.
- provider connection에 proxy pool을 지정하는 API를 추가했습니다.
  - `PUT /provider-connections/:connectionId`
  - body: `{ "proxyPoolId": "proxy_pool_id" }`
  - `null`, 빈 문자열, `"__none__"`은 9router처럼 연결 해제로 처리합니다.
  - 존재하지 않는 proxy pool id는 거부합니다.
- quota connection 상태 응답에 `proxyPoolId`를 포함했습니다.
- dashboard에 proxy pool 생성, 목록, 활성/비활성 전환, 삭제 UI를 추가했습니다.
- dashboard의 quota connection 표에서 connection별 proxy pool을 선택할 수 있게 했습니다.

검증:

```bash
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/dashboard run build
```

현재 한계:

- 당시에는 9router의 proxy pool test endpoint가 아직 없었습니다.
- 9router의 Vercel relay deploy helper는 아직 없습니다.
- 그 시점에는 quota 값을 routing/account selection 우선순위에 반영하지 않았습니다.

## 2026-05-22: provider reset time 기반 quota/rate-limit cooldown 반영

중요한 정정:

- 9router 원본은 provider quota API 조회값을 매 요청 전에 새로 호출해 scoring하는 구조가 아닙니다.
- 실제 account selection에는 `modelLock_${model}`이 반영됩니다.
- quota/rate-limit이 발생하면 해당 provider connection과 model 조합을 잠그고, 다음 요청 또는 다음 route attempt에서 잠긴 connection을 제외합니다.

완료한 일:

- 9router 원본 `open-sse/utils/error.js`, `open-sse/executors/codex.js`, `open-sse/executors/antigravity.js`, `src/sse/services/auth.js`를 기준으로 reset time 처리 흐름을 확인했습니다.
- `@pie-lab/router`에 `extractProviderResetCooldownMs()`를 추가했습니다.
- 다음 형태의 provider reset 정보를 cooldown으로 해석합니다.
  - `resetsAtMs`
  - `resetAtMs`
  - `resets_at`
  - `reset_at`
  - `resetAt`
  - `resets_in_seconds`
  - `retryAfter`
  - `retryAfterMs`
  - `reset after 1h30m`
  - `Try again in ~7 min`
- 9router의 `MAX_RATE_LIMIT_COOLDOWN_MS`처럼 provider reset time은 최대 30분으로 cap합니다.
- `ModelRegistry.markProviderConnectionUnavailable()`가 reset time을 감지하면 exponential backoff 대신 그 시간을 `modelLock_${model}` 만료 시간으로 저장합니다.
- reset time 기반 lock은 9router처럼 `backoffLevel`을 0으로 저장합니다.
- 외부 `/v1/chat/completions`의 attempt metadata도 같은 helper를 사용해 `cooldown_ms`를 계산합니다.

검증:

```bash
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts
```

현재 한계:

- 아직 9router의 `/api/models/availability` 같은 cooldown 현황 API와 dashboard 화면은 없습니다.
- 그 시점에는 provider quota API 조회값을 자동으로 모든 요청 전에 불러와 account scoring에 쓰지 않았습니다.

## 2026-05-22: model availability/cooldown API와 dashboard 1차 구현

완료한 일:

- 9router의 `/api/models/availability` 역할을 pie-lab server 흐름에 맞춰 1차 구현했습니다.
- `apps/server`에 다음 endpoint를 추가했습니다.
  - `GET /models/availability`
  - `GET /v1/models/availability`
- availability API는 `provider-connections.json`의 활성 `modelLock_${model}` 값을 읽습니다.
- 응답에는 connection별 lock 목록과 model별 lock summary를 포함합니다.
- `retryAfterMs`, `retryAfterHuman`, `until`, 최근 오류, error code, backoff level을 반환합니다.
- API key, access token, refresh token은 응답에 포함하지 않습니다.
- 이 API는 provider quota detail endpoint를 호출하지 않습니다. 실제 라우팅에서 제외 기준으로 쓰는 저장된 lock 상태만 보여줍니다.
- dashboard에 `Model cooldown` 표를 추가했습니다.
- dashboard는 잠긴 connection, provider, model scope, retry-after, 해제 예정 시간, 최근 오류를 표시합니다.

검증:

```bash
npm --workspace @pie-lab/server test -- model-availability-api.test.ts
npm --workspace @pie-lab/server run check
npm --workspace @pie-lab/dashboard run check
```

그 시점 한계:

- dashboard의 cooldown 표는 read-only입니다.
- 아직 수동 lock 해제 버튼은 없습니다.
- 아직 9router의 모델 가용성 화면 전체 UI를 그대로 이식한 것은 아니고, 현재 pie-lab routing에 필요한 `modelLock_${model}` 관찰 기능부터 붙였습니다.
- 그 시점에는 provider quota API 조회값을 자동으로 모든 요청 전에 불러와 account scoring에 쓰지 않았습니다.

## 2026-05-22: 9router clearCooldown action 기반 model lock 수동 해제

완료한 일:

- 9router 원본 `src/app/api/models/availability/route.js`의 `POST` 흐름을 확인했습니다.
- pie-lab server의 `/models/availability`에 같은 형태의 action을 추가했습니다.
  - `POST /models/availability`
  - `POST /v1/models/availability`
  - body: `{ "action": "clearCooldown", "provider": "...", "model": "..." }`
- `clearCooldown`은 해당 provider의 connection 중 `modelLock_${model}` 값이 있는 connection을 찾아 null로 비웁니다.
- connection이 `testStatus: "unavailable"`이면 9router처럼 `testStatus: "active"`, `lastError: null`, `lastErrorAt: null`, `backoffLevel: 0`으로 정리합니다.
- 응답에는 `ok`, `provider`, `model`, `lockKey`, `clearedCount`를 반환합니다.
- dashboard의 `Model cooldown` 표에 `해제` 버튼을 추가했습니다.
- 버튼은 9router와 같은 `clearCooldown` action을 호출하고, 완료 후 usage/quota/availability 화면을 다시 조회합니다.

검증:

```bash
npm --workspace @pie-lab/server test -- model-availability-api.test.ts
npm --workspace @pie-lab/server run check
npm --workspace @pie-lab/dashboard run check
```

그 시점 한계:

- 수동 해제는 특정 provider/model lock을 해제합니다. connection 하나만 골라 해제하는 별도 action은 9router 원본 흐름과 다르므로 아직 추가하지 않았습니다.
- 그 시점에는 provider quota API 조회값을 자동으로 모든 요청 전에 불러와 account scoring에 쓰지 않았습니다.

## 2026-05-23: quota-aware account selection 1차 구현

완료한 일:

- 9router 원본의 quota fetcher 결과를 pie-lab provider connection 선택 입력으로 반영했습니다.
- `@pie-lab/router`에 quota-aware account selection을 추가했습니다.
  - `fallbackStrategy: "quota-aware"`
  - `quotaStrategy: "off" | "prefer-remaining" | "require-remaining"`
  - `quotaMinRemainingPercentage`
  - `quotaMaxAgeMs`
- `providerSpecificData.pieLabQuotaSelection` snapshot을 읽어 account selection에 반영합니다.
- fresh snapshot의 `status`가 `depleted`이면 해당 connection을 선택에서 제외합니다.
- fresh snapshot끼리는 `score`가 높은 connection, 즉 잔여 quota가 높은 connection을 우선합니다.
- `@pie-lab/storage`의 provider connection settings 기본값에 quota-aware 설정을 추가했습니다.
  - `quotaStrategy: "prefer-remaining"`
  - `quotaRefreshBeforeSelection: true`
  - `quotaRefreshTtlMs: 60000`
  - `quotaMaxAgeMs: 300000`
- `apps/server`의 quota API가 provider usage 결과를 account-selection snapshot으로 요약해 저장합니다.
- `apps/server`의 기본 `ModelRegistry`는 provider connection 선택 직전에 오래된 quota snapshot을 9router quota fetcher로 갱신합니다.
- quota refresh는 provider quota API와 같은 흐름으로 OAuth refresh, proxy pool, Vercel relay, env proxy, MITM DNS bypass를 사용합니다.
- quota refresh 실패는 chat 요청 자체를 막지 않고, snapshot을 `status: "error"`로 저장해 낮은 우선순위로 취급합니다.

검증:

```bash
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts
npm --workspace @pie-lab/coding-agent run build
npm --workspace @pie-lab/server test -- provider-quota-api.test.ts chat-completions-api.test.ts
npm --workspace @pie-lab/server run check
```

현재 한계:

- `apps/server` 외부 `/v1/chat/completions` 경로는 선택 직전 quota snapshot 갱신을 수행합니다.
- coding-agent 내부 직접 실행 경로는 현재 저장된 quota snapshot을 account selection에 반영하지만, quota fetcher 자체는 아직 server 쪽 구현을 사용합니다.
- 다음 단계에서는 quota fetcher를 shared package로 분리해 내부 coding-agent 경로도 선택 직전 refresh까지 동일하게 맞추는 것이 좋습니다.

## 2026-05-23: quota fetcher/preparer shared 분리와 내부 coding-agent 연결

완료한 일:

- server에 있던 provider quota 조회/갱신 로직을 `@pie-lab/shared`로 이동했습니다.
- `@pie-lab/shared`를 buildable workspace package로 정리했습니다.
- `apps/server`의 quota API는 shared 구현을 re-export해서 기존 endpoint 계약을 유지합니다.
- `/v1/chat/completions`는 shared의 `createQuotaAwareProviderConnectionPreparer()`를 직접 사용합니다.
- `packages/coding-agent`의 기본 `createAgentSession()` 경로도 같은 quota-aware preparer를 사용합니다.
- `packages/coding-agent`의 `createAgentSessionServices()` 경로도 같은 preparer를 사용합니다.
- 이제 서버 외부 API와 내부 coding-agent 실행 모두 다음 흐름을 공유합니다.

```txt
ModelRegistry.getApiKeyAndHeaders(model)
  -> provider-connections.json 조회
  -> quotaRefreshBeforeSelection 설정 확인
  -> stale quota snapshot이면 9router quota fetcher로 갱신
  -> selectProviderConnection()
  -> quota-aware account selection
  -> 선택된 account credential 사용
```

의미:

- quota 조회/갱신 구현을 임의로 새로 만들지 않고, 앞서 이식한 9router quota fetcher 흐름을 공통화했습니다.
- 외부 OpenAI-compatible API와 내부 pi coding-agent 실행 사이의 라우팅 판단 차이를 줄였습니다.
- quota refresh 실패는 여전히 요청 자체를 막지 않고 snapshot을 `status: "error"`로 저장해 낮은 우선순위로 취급합니다.

현재 한계:

- provider 연결 생성/로그인 UI는 아직 9router 수준으로 모두 이식되지 않았습니다.
- RTK token saver와 Vercel relay deploy helper는 아직 남아 있습니다.
- quota 상세 dashboard는 현재 기본 조회 중심이며, 9router의 모든 운영 화면을 그대로 옮긴 단계는 아닙니다.

## 2026-05-23: auth.json과 provider connection 삭제/변경 동기화

완료한 일:

- `auth.json`에서 온 provider connection을 `providerSpecificData.source = "auth.json"` 기준으로 식별합니다.
- `ModelRegistry.getApiKeyAndHeaders()`가 provider connection 선택 전에 해당 provider의 auth.json 동기화를 수행합니다.
- `auth.json`의 API key가 바뀌면 기존 auth.json source connection의 credential을 갱신합니다.
- credential이 바뀐 경우 stale quota snapshot과 기존 model lock/error 상태를 정리합니다.
- `auth.json`에서 credential이 삭제되면 auth.json source connection을 비활성화하고 민감한 credential field를 비웁니다.
- 같은 provider에 사용자가 직접 만든 manual connection은 건드리지 않습니다.
- `/login`, `/logout` UI 흐름에서도 `ModelRegistry.syncAuthStorageProviderConnections(provider)`를 호출해 즉시 반영합니다.

현재 동기화 기준:

```txt
auth.json API key 저장/변경
  -> provider-connections.json의 source=auth.json connection upsert
  -> isActive=true
  -> apiKey 갱신
  -> 기존 error/modelLock/quota snapshot 정리

auth.json OAuth 저장/변경
  -> source=auth.json connection upsert
  -> accessToken/refreshToken/expires 갱신

auth.json credential 삭제/logout
  -> source=auth.json connection만 isActive=false
  -> apiKey/accessToken/refreshToken 제거
  -> modelLock/error/backoff 정리
  -> manual connection은 유지
```

검증:

```bash
npm --workspace @pie-lab/coding-agent test -- model-registry.test.ts
```

현재 한계:

- dashboard에서 provider login/logout을 직접 처리하는 UI는 아직 없습니다.
- provider connection을 완전히 삭제하는 API는 아직 없고, 현재는 비활성화와 credential 제거 방식으로 안전하게 처리합니다.

## 2026-05-23: 9router proxy pool test endpoint 반영

완료한 일:

- 9router 원본 `src/app/api/proxy-pools/[id]/test/route.js`와 `src/lib/network/proxyTest.js` 흐름을 기준으로 proxy pool test endpoint를 추가했습니다.
- `apps/server`에 다음 endpoint를 추가했습니다.
  - `POST /proxy-pools/:proxyPoolId/test`
  - `POST /v1/proxy-pools/:proxyPoolId/test`
- HTTP proxy pool은 9router처럼 `undici.ProxyAgent`로 `https://google.com/`에 `HEAD` 요청을 보내 테스트합니다.
- Vercel relay pool은 9router처럼 relay endpoint에 `x-relay-target`, `x-relay-path` header를 붙여 테스트합니다.
- 테스트 결과에 따라 proxy pool metadata를 갱신합니다.
  - 성공: `testStatus: "active"`, `lastError: null`, `isActive: true`
  - 실패: `testStatus: "error"`, `lastError`, `isActive: false`
  - 공통: `lastTestedAt`
- dashboard의 Proxy Pools 표에 `테스트` 버튼을 추가했습니다.
- dashboard는 test status, 마지막 테스트 시간, 오류 tooltip을 표시합니다.

검증:

```bash
npm --workspace @pie-lab/server test -- proxy-pools-api.test.ts
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
```

## 2026-05-23: Anthropic third-party 제한 오류 fallback 처리

문제:

- Anthropic OAuth 사용 중 `You're out of extra usage. Add more at claude.ai/settings/usage and keep going.` 오류가 발생했습니다.
- 사용자가 실제 Claude 구독을 보유하고 있어도 third-party 호출 경로에서는 제한될 수 있는 오류로 확인했습니다.
- 이 오류는 Vercel relay나 proxy pool로 우회할 수 있는 단순 네트워크 차단이 아닙니다.
- 기존 fallback 규칙은 `quota exceeded`, `usage limit`, `429` 계열을 주로 처리했고, 해당 Anthropic 문구는 `400 invalid_request_error`로 들어올 수 있어 다음 후보로 넘어가지 않을 수 있었습니다.

수정:

- router fallback 오류 규칙에 `out of extra usage`와 `usage limit` 문구를 추가했습니다.
- 이제 이 오류는 현재 provider connection/model을 cooldown 대상으로 보고, fallback 후보가 있으면 다음 route attempt로 넘어갑니다.
- Vercel relay/proxy pool은 quota 조회와 OAuth refresh 같은 provider 부가 API의 네트워크 경로 제어용이며, provider 계정 quota 자체를 늘리거나 결제/사용량 제한을 우회하는 용도로 쓰지 않습니다.

검증:

```bash
npm --workspace @pie-lab/router test -- model-selection.test.ts
```

## 2026-05-23: server provider connection 기본 경로를 pie 기준으로 수정

문제:

- `pie` CLI는 `~/.pie/agent/provider-connections.json`을 사용합니다.
- 그런데 server/dashboard의 provider connection, routing policy, quota API는 shared helper의 기본값 때문에 `~/.pi/agent/provider-connections.json`을 보고 있었습니다.
- 그 결과 dashboard에서 `auto:coding` alias를 저장해도 실제 `pie` CLI 세션에는 적용되지 않을 수 있었습니다.

수정:

- shared provider quota helper의 기본 agent dir을 `~/.pie/agent`로 변경했습니다.
- 환경변수도 새 이름인 `PIE_CODING_AGENT_DIR`을 먼저 보고, 기존 `PI_CODING_AGENT_DIR`은 legacy fallback으로만 보도록 정리했습니다.
- `auto:coding`과 `coding` intent는 Anthropic third-party 제한을 피하기 위해 `openai-codex/gpt-5.5 -> google/gemini-3.1-pro-preview` 순서로 저장해 쓰는 방향으로 정리했습니다.

검증:

```bash
npm --workspace @pie-lab/shared run build
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/router test -- model-selection.test.ts
```

현재 한계:

- Vercel relay deploy helper는 아직 없습니다.
- proxy pool test는 실제 외부 네트워크를 사용하므로 로컬/사내망/방화벽 환경에 따라 실패할 수 있습니다.

## 2026-05-23: 9router 통합 9단계 구현

완료한 일:

- account selection 설명 API를 추가했습니다.
  - `GET /account-selection`
  - `GET /v1/account-selection`
  - provider/model 기준으로 어떤 provider connection이 선택됐는지, 왜 제외됐는지, quota snapshot이 신선한지 확인할 수 있습니다.
- dashboard에 `Account 선택 이유` 표를 추가했습니다.
  - 선택된 connection, account strategy, quota strategy, 후보 connection, 제외 사유를 표시합니다.
- provider connection 관리 API를 추가했습니다.
  - `GET /provider-connections`
  - `POST /provider-connections`
  - `GET /provider-connections/:id`
  - `PUT /provider-connections/:id`
  - `DELETE /provider-connections/:id`
  - 응답에서는 API key/access token/refresh token 원문을 반환하지 않고 보유 여부만 표시합니다.
- dashboard에 provider connection 생성/활성화/비활성화/삭제 UI를 추가했습니다.
- usage dashboard를 고도화했습니다.
  - endpoint, route source, connectionId, token breakdown, pricing source, RTK 절감량을 표시합니다.
- `@pie-lab/router`에 RTK token saver를 추가했습니다.
  - OpenAI tool message, OpenAI Responses function output, Claude tool result, Kiro-style tool result를 압축 대상으로 처리합니다.
  - git diff, git status, search result list, 긴 tool output truncate 필터를 적용합니다.
- server `/v1/chat/completions`와 coding-agent SDK routed stream 경로에 RTK payload hook을 연결했습니다.
- `UsageRecord.tokenSaver`를 추가해 RTK 절감 bytes, hit 수, filter 목록을 저장합니다.
- compaction과 auto-compaction 보조 LLM 호출도 실행 전에 router resolve를 거치도록 정리했습니다.
- 9router media/tool 계열 endpoint를 server에 연결했습니다.
  - embeddings: `POST /v1/embeddings`
  - web search: `POST /v1/search`, `POST /search`
  - web fetch: `POST /v1/web/fetch`, `POST /web/fetch`
  - TTS: `POST /v1/audio/speech`
  - STT: `POST /v1/audio/transcriptions`
  - image generation: `POST /v1/images/generations`
- media/tool endpoint도 provider connection store에서 credential을 선택하고 usage record를 저장합니다.
- dashboard에 media/tool route 목록을 추가했습니다.

현재 지원 provider 범위:

```txt
embeddings
  openai, openrouter, gemini, mistral, voyage-ai, together,
  fireworks, github, nvidia, jina-ai

web search
  tavily, brave-search, serper, exa, searxng

web fetch
  firecrawl, jina-reader, tavily, exa

TTS
  openai, gemini, minimax

STT
  openai, groq, deepgram, gemini

image generation
  openai, gemini, openrouter, minimax, recraft, xai
```

검증:

```bash
npm --workspace @pie-lab/router test
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run check
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
npm --workspace @pie-lab/coding-agent run build
npm --workspace @pie-lab/coding-agent test -- sdk-router-fallback.test.ts agent-session-compaction.test.ts compaction.test.ts
```

당시 한계:

- provider setup dashboard는 manual API key/token 등록 중심이었습니다. provider별 OAuth login wizard는 아직 9router 수준으로 완전히 이식하지 않았습니다.
- media/tool endpoint는 9router의 핵심 adapter 흐름을 `pie-lab` server에 이식한 단계입니다. provider별 고급 옵션과 모든 세부 provider를 100% 옮긴 상태는 아닙니다.
- RTK는 기본 활성화이며 `PIE_LAB_RTK_ENABLED=false`로 끌 수 있습니다. dashboard에서 RTK on/off를 직접 바꾸는 UI는 아직 없습니다.
- media/tool endpoint는 당시 `provider/model` 또는 `provider`를 명시하는 방식이었습니다. `auto:image` 같은 별도 media router alias는 아직 두지 않았습니다.

## 2026-05-23: fallback chain / combo policy 편집 1차 구현

완료한 일:

- `provider-connections.json`의 settings에 `routerPolicy` 저장 구조를 추가했습니다.
- `routerPolicy`에는 9router 방식의 alias, intent mapping, combo/fallback chain, combo strategy를 저장합니다.
- `apps/server`에 routing policy API를 추가했습니다.
  - `GET /routing-policy`
  - `PUT /routing-policy`
  - `POST /routing-policy/combos`
  - `DELETE /routing-policy/combos/:comboName`
  - `POST /routing-policy/preview`
- `/v1/chat/completions`가 매 요청 시 저장된 `routerPolicy`를 읽어 `resolvePiModelRoutePlan()`에 전달하도록 연결했습니다.
- `coding-agent` 내부 routed stream 경로도 `ModelRegistry.getRouterPolicy()`를 통해 같은 `routerPolicy`를 읽도록 연결했습니다.
- dashboard에 `Fallback chain` 편집 화면을 추가했습니다.
  - combo 이름
  - provider/model 목록
  - fallback 또는 round-robin strategy
  - sticky limit
  - route preview
- routing policy API 테스트를 추가했습니다.

예시:

```json
{
  "name": "premium-coding",
  "models": [
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4.5"
  ],
  "strategy": "fallback",
  "stickyLimit": 1
}
```

이후 요청:

```json
{
  "model": "combo:premium-coding",
  "messages": [
    { "role": "user", "content": "Run" }
  ]
}
```

검증:

```bash
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/server run check
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
npm --workspace @pie-lab/coding-agent run build
npm --workspace @pie-lab/coding-agent test -- sdk-router-fallback.test.ts
```

당시 한계:

- dashboard 편집은 combo/fallback chain 중심이었습니다. alias와 intent mapping은 API 구조에 포함되어 있었지만 별도 UI는 아직 없었습니다.
- route preview는 현재 저장된 model catalog 기준입니다. provider credential이 없더라도 catalog에 model이 있으면 route plan에는 표시될 수 있습니다.
- policy import/export, drag-and-drop reorder, request detail timeline은 아직 없었습니다.

## 2026-05-23: alias / intent mapping dashboard 1차 구현

완료한 일:

- routing policy API에 alias와 intent mapping 저장/삭제 endpoint를 추가했습니다.
  - `POST /routing-policy/aliases`
  - `DELETE /routing-policy/aliases/:aliasName`
  - `POST /routing-policy/intents`
  - `DELETE /routing-policy/intents/:intentName`
- dashboard의 `Routing policy` 영역에서 alias와 intent mapping을 직접 생성, 수정, 삭제할 수 있게 했습니다.
- `auto:coding` 같은 alias와 `chat` 같은 intent가 저장된 `routerPolicy`를 통해 `resolvePiModelRoutePlan()`에 반영되도록 확인했습니다.
- `/routing-policy/preview`에서 alias 또는 intent 기반 요청의 후보 model 순서를 확인할 수 있습니다.
- `/v1/chat/completions` 요청이 저장된 alias mapping을 따라 실제 provider/model로 resolve되는 테스트를 추가했습니다.

예시:

```json
{
  "name": "auto:coding",
  "models": [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-5.4"
  ]
}
```

또는 intent mapping:

```json
{
  "name": "chat",
  "models": [
    "openai/gpt-5.4"
  ]
}
```

검증:

```bash
npm --workspace @pie-lab/server run check
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/server test -- router-integration-api.test.ts
```

당시 한계:

- alias/intent mapping은 수동 입력 방식이었습니다. 모델 후보 추천이나 순서 편집은 아직 없었습니다.
- policy import/export와 request detail timeline은 아직 없었습니다.

## 2026-05-23: router 운영 dashboard 고도화 1차 구현

완료한 일:

- OAuth connection import wizard를 dashboard에 추가했습니다.
  - provider, email, access token, refresh token, project id, providerSpecificData JSON을 입력해 `authType: "oauth"` connection으로 저장합니다.
  - 실제 browser redirect 기반 OAuth login flow는 아직 아니지만, 9router식 OAuth token 저장/refresh 경로에 연결됩니다.
- `GET/PUT /provider-settings` API를 추가했습니다.
  - quota strategy, quota 최소 잔량 기준, quota refresh TTL을 dashboard에서 편집합니다.
  - budget policy는 `budgetLimits`로 저장합니다.
- provider health 화면을 고도화했습니다.
  - provider별 connection 수, 활성 connection 수, 오류 connection 수, cooldown lock 수를 함께 표시합니다.
- quota 상세 화면을 고도화했습니다.
  - quota selection snapshot의 status, score, checkedAt, resetAt을 표시합니다.
  - quota window별 remaining percentage bar를 표시합니다.
- media/tool route API를 추가했습니다.
  - `GET /media/routes`
  - `GET /v1/media/routes`
  - 지원 provider, auth 방식, format, default media alias 후보를 dashboard에 표시합니다.
- media endpoint가 `routerPolicy`의 media alias를 해석합니다.
  - 예: `auto:image` -> `openai/gpt-image-1`
  - `extra_body`를 upstream request body에 merge해 provider별 고급 옵션을 넘길 수 있습니다.
- usage request detail API를 추가했습니다.
  - `GET /usage/:requestId`
  - `GET /v1/usage/:requestId`
  - request 단위 attempt timeline, token, cost, fallback status를 반환합니다.
- dashboard에 request detail / fallback timeline 화면을 추가했습니다.
- routing policy 편의 기능을 추가했습니다.
  - policy JSON export/import
  - combo 순서 위/아래 이동
  - `/v1/models`와 `/media/routes` 기반 model suggestion datalist

검증:

```bash
npm --workspace @pie-lab/storage test
npm --workspace @pie-lab/storage run build
npm --workspace @pie-lab/server run check
npm --workspace @pie-lab/server test
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
npm --workspace @pie-lab/coding-agent run build
npm --workspace @pie-lab/coding-agent test -- sdk-router-fallback.test.ts
```

당시 한계:

- OAuth wizard는 redirect/login flow가 아니라 token import 방식입니다.
- budget policy는 저장과 dashboard 편집까지 구현했습니다. 실제 요청 차단 enforcement는 다음 단계로 둘 수 있습니다.
- request detail은 usage record 기반 timeline입니다. provider별 raw event까지 보여주는 deep trace는 아직 없습니다.

## 2026-05-23: budget enforcement와 OAuth redirect login 1차 구현

완료한 일:

- `apps/server/src/budget-policy.ts`를 추가했습니다.
  - `provider-settings`의 `budgetLimits`를 공통 정책으로 평가합니다.
  - daily/monthly window는 UTC 기준으로 계산합니다.
  - request limit은 요청 전 추정 비용이 있을 때 평가합니다.
  - mode가 `warn`이면 violation만 표시하고, `block`이면 요청을 차단합니다.
- `GET /budget`, `GET /v1/budget` API를 추가했습니다.
  - dashboard에서 현재 provider/global budget 사용량, projected cost, 소진 여부를 조회합니다.
- `POST /v1/chat/completions`에 budget enforcement를 연결했습니다.
  - route attempt 직전에 budget을 확인합니다.
  - 특정 provider가 budget block이면 해당 attempt를 `skipped` usage record로 저장하고, fallback 후보가 있으면 다음 route로 넘어갑니다.
  - 마지막 route까지 budget에 막히면 `402 budget_limit_exceeded`를 반환합니다.
- media/tool endpoint에도 budget enforcement를 연결했습니다.
  - `/v1/embeddings`, `/v1/search`, `/v1/web/fetch`, `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/images/generations`가 같은 budget policy를 따릅니다.
  - web search/fetch처럼 request 단가가 있는 endpoint는 request/daily/monthly projected cost에 반영합니다.
- `apps/server/src/oauth-api.ts`를 추가했습니다.
  - `GET /oauth/providers`
  - `GET /oauth/start`
  - `POST /oauth/callback`
  - `GET /oauth/callback`
  - 1차 provider는 `claude`, `codex`, `gemini-cli`입니다.
- dashboard에 browser redirect 기반 OAuth login form을 추가했습니다.
  - 기존 OAuth token import wizard는 그대로 유지했습니다.
  - redirect callback에서 받은 `code`, `state`, `codeVerifier`로 server가 token exchange를 수행하고 provider connection으로 저장합니다.
- dashboard의 Routing / Budget 설정 아래에 budget 사용/소진 상태를 표시합니다.

검증:

```bash
npm --workspace @pie-lab/server run check
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/server test
```

남은 한계:

- OAuth provider별 consent 화면은 실제 provider 계정으로 live 검증이 필요합니다.
- Gemini CLI는 quota 조회에 `projectId`가 필요할 수 있으므로 dashboard redirect form에서 Project ID를 함께 입력할 수 있게 했습니다.
- request cost는 실제 응답 전에는 정확히 알 수 없기 때문에, chat은 입력 크기와 `max_tokens` 기반 추정값을 사용합니다.

## 2026-05-23: pie-chat 명칭 정리와 request raw trace 구현

완료한 일:

- `apps/chat-bridge` package 이름을 `@pie-lab/pie-chat`으로 정리했습니다.
- 문서에서는 `pie-chat` 명칭을 사용하되, 실제 source 출처는 기존 fork인 `https://github.com/jikime/pi-chat`으로 남겼습니다.
- `pie-chat` 실제 기능 통합은 마지막 단계로 두고, 기존 `pi-chat` bridge 흐름을 가져온 뒤 LLM 직접 호출만 `pie-lab agent runtime -> router` 경로로 바꾸는 원칙을 명시했습니다.
- `apps/server`에 `pielab.ai` 운영용 최소 site endpoint를 추가했습니다.
  - `GET /api/latest-version`
  - `GET/POST /api/report-install`
  - `GET /install.sh`
  - `GET /session`
- `UsageRecord`에 `trace` event 배열을 추가했습니다.
- server `/v1/chat/completions` non-stream/stream 경로에서 attempt start, budget check/block, auth resolve, upstream completion/error, stream event, fallback decision을 trace로 저장합니다.
- 내부 `coding-agent` routed stream usage record에도 attempt 단위 trace를 남기도록 했습니다.
- `GET /usage/:requestId`, `GET /v1/usage/:requestId` 응답에 request 단위 raw trace를 포함했습니다.
- dashboard request detail 화면에 fallback timeline 아래 raw event trace를 표시하도록 했습니다.
- trace에는 프롬프트/응답 원문을 저장하지 않고 event type, provider/model, connectionId, attempt index, token/cost 같은 디버깅용 metadata만 저장합니다.

검증:

```bash
npm --workspace @pie-lab/server test -- usage-api.test.ts chat-completions-api.test.ts
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/coding-agent test -- sdk-router-fallback.test.ts
```

당시 남은 큰 항목:

- Vercel deploy helper
- media endpoint별 provider coverage 확대
- `pie-chat` 실제 bridge 통합

## 2026-05-23: media coverage와 provider deep probe 1차 구현

완료한 일:

- media endpoint coverage를 확장했습니다.
  - embedding: `cohere/embed-v4.0`, `ollama/nomic-embed-text`
  - TTS: `elevenlabs/eleven_multilingual_v2`
  - STT: `elevenlabs/scribe_v2`
- Cohere v2 embed 응답을 OpenAI-compatible embedding shape로 normalize합니다.
- Ollama local embedding 응답을 OpenAI-compatible embedding shape로 normalize합니다.
- ElevenLabs TTS는 `xi-api-key` 인증, `voice` 또는 connection의 `providerSpecificData.voiceId`를 사용합니다.
- ElevenLabs STT는 multipart `file`, `model_id`, language/diarization 관련 옵션을 전달하고 transcript 응답을 normalize합니다.
- `GET /providers/probe`, `GET /v1/providers/probe`를 추가했습니다.
  - provider auth, active connection, cooldown, quota snapshot을 provider 단위로 점검합니다.
  - connection별 active/credential/cooldown/quota check를 함께 반환합니다.
  - `?live=true`를 주면 OpenAI-compatible provider, Cohere, ElevenLabs 등 일부 provider에 대해 가벼운 live endpoint probe를 수행할 수 있습니다.
- dashboard의 Provider 인증 섹션에 deep probe 표를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/server test -- router-integration-api.test.ts provider-status-api.test.ts
npm --workspace @pie-lab/server run build
npm --workspace @pie-lab/dashboard run check
```

현재 남은 큰 항목:

- Vercel deploy helper
- `pie-chat` 실제 bridge 통합

## 2026-05-23: 프로젝트 이름을 pie-lab으로 변경

완료한 일:

- 프로젝트 이름을 가칭 `pie-adk`에서 `pie-lab`으로 변경했습니다.
- root package name을 `pie-lab`으로 변경했습니다.
- workspace package scope를 `@pie-lab/*`로 정리했습니다.
- TypeScript path alias, package dependency, vitest alias, source import를 `@pie-lab/*` 기준으로 변경했습니다.
- router 가상 provider 이름을 `pie-lab-router`로 변경했습니다.
- quota selection snapshot key를 `pieLabQuotaSelection`으로 변경했습니다.
- 새 환경변수는 `PIE_LAB_*`, `VITE_PIE_LAB_*`를 사용하도록 변경했습니다.
- 기존 로컬 설정을 바로 끊지 않도록 `PIE_ADK_*`, `VITE_PIE_ADK_API_BASE`, `pie-adk-router`, `pieAdkQuotaSelection`은 읽기 fallback으로 유지했습니다.
- CLI 명령어 `pie`, 설정 디렉터리 `.pie`, 기본 agent dir `~/.pie/agent`는 그대로 유지했습니다.

검증:

```bash
npm install
npm run build
```

## 2026-05-23: source 실행 스크립트 이름을 pie-test로 변경

완료한 일:

- 기존 source 실행 스크립트 이름을 `pie-test.sh`, `pie-test.bat`, `pie-test.ps1`로 변경했습니다.
- README, AGENTS, development 문서의 source 실행 예시를 `./pie-test.sh` 기준으로 변경했습니다.
- 테스트 fixture와 임시 디렉터리 prefix도 `pie-test` 기준으로 정리했습니다.

검증:

```bash
./pie-test.sh --version
./pie-test.sh --help
```

## 2026-05-23: npm 전역 설치 기준 정리

완료한 일:

- 공식 CLI 설치 명령을 `npm install -g --ignore-scripts @pie-lab/coding-agent`로 정했습니다.
- `pie-lab/pie-coding-agent` 형태는 GitHub shorthand라 공식 설치 경로로 쓰지 않기로 했습니다.
- `@pie-lab/coding-agent`의 `bin`은 계속 `pie`를 가리키도록 유지했습니다.
- npm scoped package가 공개 배포되도록 publish 대상 package에 `publishConfig.access=public`을 추가했습니다.
- `@pie-lab/coding-agent`가 전역 설치될 때 필요한 런타임 의존 패키지인 `@pie-lab/router`, `@pie-lab/storage`, `@pie-lab/shared`의 `private` 설정을 제거했습니다.
- README와 coding-agent 문서의 npm 설치 예시를 `--ignore-scripts` 기준으로 맞췄습니다.
- `pie` 내부 self-update 안내도 npm 설치 방식에서는 `--ignore-scripts`를 포함하도록 변경했습니다.

검증:

```bash
npm --workspace @pie-lab/coding-agent test -- config.test.ts
npm --workspace @pie-lab/coding-agent run build
npm --workspace @pie-lab/coding-agent exec pie -- --version
npm pack --workspace @pie-lab/coding-agent --dry-run
```

## 2026-05-23: Node 로컬 개발 버전 고정

완료한 일:

- `npm install` 시 Node `22.12.0`에서 `EBADENGINE` 경고가 발생하는 문제를 확인했습니다.
- root package와 주요 패키지, `undici@8.3.0`이 Node `>=22.19.0`을 요구하므로 요구 버전은 낮추지 않기로 했습니다.
- `.nvmrc`와 `.node-version`을 `22.19.0`으로 추가해 로컬 개발자가 같은 Node 기준을 사용할 수 있게 했습니다.
- README와 coding-agent development 문서에 Node 버전 전환 후 `npm install`을 실행하도록 안내를 추가했습니다.

## 2026-05-23: Google 라우터 경유 AbortSignal 오류 수정

문제:

- `pie` 세션에서 라우터가 `google/gemini-3.1-pro-preview`로 요청을 보낼 때 `abortSignal.addEventListener is not a function` 오류가 발생했습니다.
- 사용량 로그상 요청은 `routingMode=fallback`, `resolvedProvider=google`로 기록되어 라우터 경유 Google provider 호출에서 발생한 문제로 확인했습니다.

원인:

- 라우터 경유 시 RTK token saver가 provider payload를 `JSON.stringify/parse` 방식으로 clone했습니다.
- Google payload에는 `config.abortSignal`이 포함되는데, JSON clone 과정에서 실제 `AbortSignal` 인스턴스가 일반 객체로 바뀌었습니다.
- 이후 `@google/genai` SDK가 `abortSignal.addEventListener()`를 호출하면서 오류가 발생했습니다.

수정:

- RTK payload clone을 plain object/array만 깊게 복사하고, `AbortSignal` 같은 런타임 객체는 그대로 보존하도록 변경했습니다.
- `AbortSignal` 보존 회귀 테스트를 추가했습니다.

검증:

```bash
npm --workspace @pie-lab/router test -- model-selection.test.ts
npm --workspace @pie-lab/router run build
npm --workspace @pie-lab/coding-agent test -- sdk-router-fallback.test.ts
./pie-test.sh --version
```

## 2026-05-23: Dashboard route 표시 의미 정리

문제:

- `pie` CLI에서 `gpt-5.5`처럼 구체 모델을 직접 선택하면 라우터를 통과하되 `routingMode=fallback`, `routeSource=fallback`으로 기록됩니다.
- 이 값은 "직접 지정 모델을 우선 실행하고 실패 시 fallback 가능"이라는 내부 모드인데, dashboard에서는 `fallback` 원문만 보여 실제로 다른 모델로 우회된 것처럼 보일 수 있었습니다.

수정:

- 최근 요청 테이블의 Route 열을 원문 `fallback` 대신 사람이 이해하기 쉬운 라벨로 표시하도록 바꿨습니다.
- `routeSource=fallback`이더라도 `attemptCount=1`이면 실제 fallback 전환이 없으므로 `Direct / fallback-ready`로 표시합니다.
- fallback chain에서 첫 후보는 `Primary`, 뒤 후보는 `Fallback`으로 표시합니다.
- router alias나 policy로 선택된 요청은 `Router / auto selected`, 고정 모델 요청은 `Fixed / locked model`로 표시합니다.
- 요청 상세 timeline도 같은 기준으로 route 의미를 보여주도록 맞췄습니다.

검증:

```bash
npm --workspace @pie-lab/dashboard run check
npm --workspace @pie-lab/dashboard run build
```

## 2026-05-23: Next.js 대시보드 Pretendard 및 SEO 적용

완료한 일:

- `apps/dashboard-next`의 기본 폰트를 Geist에서 Pretendard로 변경했습니다.
- 루트 HTML 언어를 `ko`로 설정했습니다.
- `pielab.ai`를 기본 canonical 도메인으로 사용하는 공통 SEO 설정을 추가했습니다.
- Overview, Routing, Providers, Usage, Quota, Media, Proxy, Logs, Settings 페이지별 title/description 메타데이터를 추가했습니다.
- Open Graph, Twitter card, robots, sitemap, web app manifest 메타데이터를 추가했습니다.
- README에 Pretendard와 `NEXT_PUBLIC_SITE_URL` 설정 방법을 기록했습니다.

검증:

```bash
npm --workspace @pie-lab/dashboard-next run lint
npm --workspace @pie-lab/dashboard-next run build
```

브라우저 확인:

- `http://127.0.0.1:4876/`의 title, description, canonical, Open Graph, Twitter card가 정상 표시됨을 확인했습니다.
- `document.fonts.check("16px Pretendard")`가 `true`로 반환됨을 확인했습니다.
- `robots.txt`, `sitemap.xml`, `manifest.webmanifest`가 정상 응답함을 확인했습니다.

## 2026-05-23: pie-chat app 위치를 apps/chat으로 정리

완료한 일:

- `apps/chat-bridge`를 `apps/chat`으로 리네임했습니다.
- `apps/chat`은 앞으로 웹 기반 `pie-chat`과 Discord/Telegram bridge를 함께 담는 app 영역으로 정리했습니다.
- `packages/chat`은 SDK-neutral 공통 message/event 타입과 유틸을 담당하고, 실제 실행 app은 `apps/chat`에 둡니다.
- 관련 architecture, migration, roadmap, current decisions 문서를 `apps/chat` 기준으로 업데이트했습니다.

## 2026-05-23: apps/chat Next.js 웹 채팅 MVP 구현

완료한 일:

- `apps/chat`을 Next.js 16, React 19, Tailwind CSS 4 기반 앱으로 전환했습니다.
- Pretendard, shadcn/ui 스타일 컴포넌트, 기본 SEO metadata, robots, sitemap, manifest를 추가했습니다.
- 기본 실행 포트를 `4877`로 정했습니다.
- `NEXT_PUBLIC_PIE_API_BASE_URL` 기본값을 `http://127.0.0.1:4873`으로 두고 `apps/server`의 `/v1/chat/completions`를 호출하도록 연결했습니다.
- 기본 모델은 `auto:chat`으로 설정하고, `auto:coding`, `auto:reasoning`으로 빠르게 바꿀 수 있게 했습니다.
- streaming 응답을 SSE로 파싱하고 assistant 메시지에 누적 표시합니다.
- 응답 chunk의 `pi_adk` metadata를 읽어 routing mode, resolved provider, resolved model을 메시지 아래에 표시합니다.

검증:

```bash
npm --workspace @pie-lab/pie-chat run lint
npm --workspace @pie-lab/pie-chat run build
```

브라우저 확인:

- `http://127.0.0.1:4877/`에서 Pie Chat 화면이 렌더링됨을 확인했습니다.
- `lang=ko`, Pretendard font, metadata description, icon, composer, 기본 모델 `auto:chat`을 확인했습니다.
- Next.js MCP `get_errors`에서 config/session error가 없음을 확인했습니다.
- browser console error/warning이 없음을 확인했습니다.

## 2026-05-23: auto:chat Google 모델 정책 2.5 이상으로 조정

문제:

- `pie-chat`의 기본 모델은 고정 Gemini 모델이 아니라 `auto:chat`입니다.
- 현재 라우터 자동 선택 과정에서 Google의 `gemini-2.0-flash` 계열이 선택될 수 있었고, 이 모델은 신규 사용자에게 404 응답을 반환할 수 있었습니다.

수정:

- 자동 라우팅 후보에서 `gemini-2.0-flash`, `gemini-2.0-flash-001`, `gemini-2.0-flash-lite`, `gemini-2.0-flash-lite-001`을 제외했습니다.
- 실행 중인 라우터 정책에 `auto:chat` alias와 `chat` intent를 아래 순서로 저장했습니다.
  - `google/gemini-3.1-pro-preview`
  - `google/gemini-2.5-flash`
- `auto:coding`에서 사용 중인 Google fallback 기준과 맞춰, 채팅도 Google 2.5 이상 모델만 타도록 정리했습니다.

확인:

```bash
curl -sS -X POST http://127.0.0.1:4873/routing-policy/preview \
  -H 'content-type: application/json' \
  -d '{"model":"auto:chat"}'
```

결과:

```json
{
  "requestedModel": "auto:chat",
  "routingMode": "router",
  "routes": [
    { "provider": "google", "model": "gemini-3.1-pro-preview" },
    { "provider": "google", "model": "gemini-2.5-flash" }
  ]
}
```
