# 마이그레이션 계획

이 문서는 `pi`, `9router`, `pie-chat`을 `pie-lab`로 통합할 때의 실제 작업 순서를 정리합니다.

## 기본 전략

처음부터 모든 파일을 섞지 않습니다.

먼저 `pie-lab`라는 별도 git repository를 만듭니다. 그 repository의 초기 코드베이스로 `pi` 소스를 그대로 가져옵니다. 그 다음 같은 repository 안에서 `9router`와 `pie-chat`을 통합하고, 필요한 부분을 역할별 패키지와 앱으로 점진적으로 정리합니다.

좋은 순서는 다음과 같습니다.

```txt
1. pie-lab repository 생성 후 pi source를 초기 코드베이스로 가져오기
2. pi 기존 기능과 workflow 보존선 확인
3. 9router server/dashboard/cli 이식
4. model selection과 routing mode 정의
5. router와 provider 호출 경계 정리
6. agent runtime 추가
7. dashboard와 CLI를 pie-lab 명령 체계로 정리
8. pie-chat 기반 chat bridge 통합
```

## 1단계: pie-lab repository 생성 후 pi source를 초기 코드베이스로 가져오기

빈 코드베이스에서 시작하지 않습니다. 별도 `pie-lab` git repository를 만들고, 그 안에 `pi`의 소스를 초기 코드베이스로 가져옵니다.

추천 작업:

- `pie-lab`라는 별도 repository를 생성합니다.
- `pi` repository의 현재 source tree를 `pie-lab` repository의 초기 코드베이스로 가져옵니다.
- 가능하면 import commit에 `pi` 원본 commit hash를 기록합니다.
- 기존 `pi`의 package 구조, scripts, tests, CLI/TUI 흐름을 그대로 유지합니다.
- 원본 `pi`의 LICENSE와 attribution을 보존합니다.
- `9router`, `pie-chat` 원본도 별도 fork/clone으로 추적 가능하게 둡니다.

이 단계에서는 새 구조를 만들기보다, 기존 `pi`가 정상 동작하는 baseline을 확보하는 것이 중요합니다.

초기 목표 구조는 `pi`의 기존 구조를 유지하면서 필요한 앱과 패키지를 추가하는 방식입니다.

```txt
pie-lab/
  # existing pi source + added packages
  packages/
    ...
    router/
    storage/
    chat/
    shared/

  scripts/
  .pie/

  # added from 9router/pie-chat
  apps/
    dashboard/
    server/
    chat/
```

기존 `pi/packages/*`는 가능한 한 그대로 둡니다. 통합 과정에서 새로 필요한 영역만 추가합니다.

패키지 이름 예시:

```txt
기존 pi package 이름은 초기에는 유지
@pie-lab/router
@pie-lab/storage
@pie-lab/chat
@pie-lab/shared
```

## 2단계: pi 기존 기능과 workflow 보존선 확인

`pie-lab`은 `pi`의 일부 provider 코드만 가져오는 프로젝트가 아닙니다. 따라서 통합 전에 `pi`의 기존 기능 중 반드시 보존할 workflow를 먼저 확인합니다.

대상:

```txt
pi/packages/*
pi/scripts/*
pi/.pie/*
pi/AGENTS.md
```

이 단계에서는 코드를 옮기지 않습니다. 먼저 보존할 기능과 변경해도 되는 기능을 나눕니다.

주의할 점:

- 사용자-facing package/workspace 이름은 `@pie-lab/*`로 정리합니다.
- provider별 코드뿐 아니라 기존 `pi`의 runtime, extension, tool, session 흐름도 동작을 보존합니다.
- 기존 `pi` 사용자가 기대하는 핵심 workflow는 가능한 한 깨지지 않게 합니다.
- 대규모 리팩터링은 `9router`, `pie-chat` 통합이 동작한 이후에 합니다.
- 기존 tests는 baseline으로 유지합니다.

## 3단계: 9router server/dashboard/cli 이식

`9router`는 실행 환경을 제공합니다.

대상:

```txt
9router/src/app
9router/src/app/api
9router/src/proxy.js
9router/src/lib/*Db.js
9router/src/store
9router/cli
9router/src/shared
```

재배치 예시:

```txt
9router/src/app
  -> apps/dashboard/src/app

9router/src/app/api/v1
  -> apps/server/src/openai-compatible

9router/src/proxy.js
  -> packages/router/src/openai-proxy.ts

9router/src/lib/usageDb.js
  -> packages/storage/src/usage.ts

9router/cli
  -> apps/cli
```

주의할 점:

- dashboard를 먼저 완전히 고치려 하지 않습니다.
- 기존 API route를 server package 경계에 맞춰 점진적으로 옮깁니다.
- DB 관련 코드는 `packages/storage`로 분리합니다.
- CLI는 처음에는 기존 기능 유지 후 명령 이름만 `pie-lab`로 바꿉니다.

## 4단계: 중복 provider 기능 정리

가장 중요한 단계입니다.

정리 기준:

```txt
실제 모델 호출
  -> packages/providers

provider 계정 설정
  -> packages/storage

어떤 provider를 쓸지 결정
  -> packages/router

UI 표시용 metadata
  -> packages/shared
```

중복이 생기기 쉬운 영역:

- provider 목록
- model 목록
- OAuth token refresh
- OpenAI-compatible request 변환
- Anthropic/OpenAI message 변환
- usage 계산
- pricing metadata

이 영역은 한 번에 정리하기보다 테스트를 붙인 뒤 하나씩 합치는 편이 안전합니다.

## 5단계: model selection과 routing mode 정의

`pi`는 model을 직접 지정하는 SDK에 가깝고, `9router`는 최적의 model/account를 선택하는 router에 가깝습니다.

이 둘을 통합할 때 가장 먼저 정리해야 할 부분은 model 선택 권한입니다.

`pie-lab`에서는 다음 세 가지 모드를 공식 규칙으로 둡니다.

```txt
fixed    = caller/agent가 model 결정, router는 model 변경 금지
router   = router가 intent/alias를 보고 model 결정
fallback = caller/agent가 primary model 결정, 실패 시 router가 대체
```

### 문자열 model 해석 규칙

OpenAI-compatible API에서는 model이 문자열로 들어오므로, 다음 규칙으로 normalize합니다.

```txt
fixed:openai/gpt-4.1-mini
  -> { mode: "fixed", model: "openai/gpt-4.1-mini" }

fallback:anthropic/claude-sonnet-4.5
  -> { mode: "fallback", primary: "anthropic/claude-sonnet-4.5" }

auto:coding
  -> { mode: "router", intent: "coding" }

cheap:coding
  -> { mode: "router", intent: "coding", constraints: { budget: "low" } }

fast:chat
  -> { mode: "router", intent: "chat", constraints: { latency: "low" } }

combo:coding
  -> router-defined combo

openai/gpt-4.1-mini
  -> { mode: "fallback", primary: "openai/gpt-4.1-mini" }
```

`provider/model`에 prefix가 없으면 기본값은 `fallback`으로 둡니다.

재현성이 필요한 테스트나 benchmark에서는 반드시 `fixed:` prefix를 사용합니다.

### 구현 위치

초기 구현 위치는 다음처럼 둡니다.

```txt
packages/core/src/model-selection.ts
  -> ModelSelection 타입
  -> parseModelSelection()
  -> formatModelSelection()

packages/router/src/resolve.ts
  -> resolveRoute(selection, context)
  -> fixed/router/fallback mode 처리

apps/server/src/openai-compatible/*
  -> request.body.model을 ModelSelection으로 normalize
```

### 테스트

이 단계에서는 실제 provider 호출보다 parsing과 policy 테스트가 중요합니다.

필수 테스트:

- `fixed:provider/model`은 fixed mode로 해석됩니다.
- `fallback:provider/model`은 fallback mode로 해석됩니다.
- `auto:coding`은 router mode로 해석됩니다.
- prefix 없는 `provider/model`은 fallback mode로 해석됩니다.
- fixed mode에서는 router가 model을 바꾸지 않습니다.
- fallback mode에서는 primary 실패 시 fallback chain을 사용할 수 있습니다.

## 6단계: router를 pi runtime/provider 기반 위에 연결

목표 호출 구조:

```txt
internal pi runtime or external OpenAI-compatible request
  -> normalize model selection
  -> router policy
  -> provider engine call
  -> response mapping
  -> usage logging
```

처음에는 하나의 endpoint만 성공시키면 됩니다.

우선순위:

```txt
1. POST /v1/chat/completions non-stream
2. POST /v1/chat/completions stream
3. GET /v1/models
4. POST /v1/responses
5. Anthropic-compatible endpoint
```

처음 MVP에서는 외부 호환성 검증을 위해 HTTP adapter 방식도 허용합니다.

```txt
pie-lab agent/runtime
  -> router provider adapter
  -> local /v1/chat/completions
  -> 9router-compatible handler
  -> provider engine
```

이 방식은 기존 `9router` 라우팅 흐름을 빠르게 활용할 수 있습니다. 다만 최종 구조에서는 HTTP 왕복을 줄이고 `packages/router`를 직접 호출하는 in-process 구조로 옮깁니다.

최종 원칙:

```txt
내부 pi 실행은 HTTP를 거치지 않는다.
외부 client만 apps/server의 HTTP adapter를 거친다.
두 경로 모두 같은 packages/router를 사용한다.
```

`9router`에서 우선 이식할 것은 executor 전체가 아니라 routing/fallback/account/usage policy입니다.

```txt
가져올 것:
  model alias
  combo/fallback
  account selection
  quota/rate-limit handling
  usage/cost tracking
  pricing override

피할 것:
  pi provider engine을 우회하는 별도 provider executor 중복
```

## 7단계: agent runtime 추가

초기 agent runtime은 `packages/agent`에서 시작합니다.

필수 API:

```ts
defineTool()
defineAgent()
runAgent()
```

초기 예제:

```txt
examples/simple-chat
examples/file-summary-agent
examples/coding-review-agent
```

agent runtime은 provider를 직접 호출하지 않고 router를 통해 호출합니다.

이유는 간단합니다. 그래야 fallback, quota, usage log가 모든 호출에 일관되게 적용됩니다.

agent 정의에서는 문자열 model보다 structured model selection을 우선 지원합니다.

```ts
defineAgent({
  name: "code-reviewer",
  model: {
    mode: "router",
    intent: "coding",
    constraints: {
      requireTools: true
    }
  }
});
```

OpenAI-compatible client와 CLI 편의를 위해 문자열 model도 함께 지원합니다.

## 8단계: dashboard와 CLI 정리

기능이 어느 정도 연결되면 이름과 사용자 경험을 정리합니다.

CLI 명령 예시:

```bash
pie start
pie status
pie provider list
pie provider add
pie model list
pie agent run ./agents/code-reviewer
```

dashboard 메뉴 예시:

```txt
Overview
Providers
Models
Routing
Usage
Agents
Logs
Settings
```

## 9단계: pie-chat 기반 chat bridge 통합

`pie-chat`은 Discord/Telegram 같은 외부 채팅 채널을 pi session과 연결하는 bridge입니다.

`pie-lab`에서는 이 기능을 core가 아니라 channel integration layer로 흡수합니다.

대상:

```txt
pie-chat/src/live/*
pie-chat/src/services/*
pie-chat/src/runtime.ts
pie-chat/src/config.ts
pie-chat/src/secrets.ts
pie-chat/src/tui/*
pie-chat/src/render/*
```

재배치 예시:

```txt
pie-chat/src/live/*
  -> apps/chat/src/providers/*

pie-chat/src/services/*
  -> apps/chat/src/services/*

pie-chat/src/config.ts
  -> packages/chat/src/config.ts

pie-chat/src/runtime.ts
  -> packages/chat/src/runtime.ts 또는 apps/chat/src/runtime.ts

pie-chat/src/secrets.ts
  -> packages/chat/src/secrets.ts

pie-chat/src/render/*
  -> packages/chat/src/render/*
```

통합 원칙:

- chat bridge는 provider를 직접 호출하지 않습니다.
- Discord/Telegram message는 agent input으로 normalize합니다.
- agent 실행은 `packages/agent`를 통해 시작합니다.
- agent의 LLM 호출은 반드시 `packages/router`를 통과합니다.
- chat에서 발생한 요청도 usage/cost tracking 대상입니다.
- channel/account memory는 `packages/storage`의 설정과 연결합니다.

초기 범위:

```txt
1. Discord/Telegram 중 하나만 먼저 연결
2. text message -> agent run -> text reply
3. status/new/stop 같은 최소 remote command
4. chat-origin usage record 저장
```

후속 범위:

```txt
1. file attachment
2. encrypted secret exchange
3. tmux worker orchestration
4. Gondolin VM sandbox
5. dashboard에서 chat channel/worker 상태 확인
```

## 마이그레이션 중 지켜야 할 규칙

- 기능 이동과 기능 변경을 같은 PR에서 크게 섞지 않습니다.
- provider 호출 결과가 바뀌는 작업에는 테스트를 붙입니다.
- dashboard UI 변경은 API 경계가 안정된 뒤 진행합니다.
- 기존 `9router` 사용자가 기대하는 `/v1` endpoint는 유지합니다.
- agent 기능은 MVP 후반에 붙입니다.
- model 선택은 `fixed`, `router`, `fallback` 세 모드 중 하나로 명시합니다.
- 재현성이 중요한 테스트에는 `fixed:` model prefix를 사용합니다.
- `pie-chat` 기능은 MVP를 키우지 않도록 chat bridge 단계에서 점진적으로 통합합니다.
- chat bridge에서 발생한 LLM 요청도 router와 usage tracking을 반드시 거칩니다.

## 첫 번째 milestone

가장 먼저 달성할 milestone은 다음입니다.

```txt
pie start
  -> local server 실행
  -> dashboard 접근 가능
  -> provider 1개 등록 가능
  -> /v1/chat/completions 호출 가능
  -> 기존 pi 핵심 workflow 보존
  -> 내부 호출은 pi runtime/provider 기반 사용
  -> usage log 저장
```

이 milestone이 되면 통합 방향이 실제로 맞는지 빠르게 검증할 수 있습니다.
