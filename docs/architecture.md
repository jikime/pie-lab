# 통합 아키텍처

## 전체 구조

`pie-lab`은 별도 git repository로 만들되, 초기 코드베이스는 `pi` 소스를 그대로 사용합니다. 따라서 처음부터 빈 monorepo를 새로 만드는 것이 아니라, 기존 `pi` 구조를 유지한 상태에서 필요한 앱과 패키지를 추가합니다.

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

  # added integration apps
  apps/
    dashboard/
    server/
    chat/

  docs/
```

## 각 영역의 책임

### apps/dashboard

`9router`의 Next.js dashboard를 기반으로 합니다.

담당 기능:

- provider 등록/수정/삭제
- API key와 OAuth 상태 확인
- quota와 사용량 확인
- 요청 로그 확인
- 모델 alias와 fallback policy 관리
- agent 실행 기록 확인

초기에는 `9router/src/app`을 기반으로 옮기되, 내부 API 호출은 새 `packages/router`, `packages/storage` 경계에 맞춰 점진적으로 정리합니다.

현재 구현은 usage 확인을 넘어 router 운영 화면까지 포함합니다.

```txt
apps/dashboard
  -> GET /usage
  -> GET /usage/summary
  -> GET /providers
  -> GET /provider-connections
  -> GET /account-selection
  -> GET /quota
  -> GET /models/availability
  -> GET /proxy-pools
  -> GET /routing-policy
  -> POST /routing-policy/combos
  -> POST /routing-policy/aliases
  -> POST /routing-policy/intents
  -> POST /routing-policy/preview
  -> summary card / provider aggregate / model aggregate / recent records 표시
  -> provider auth status 표시
  -> provider connection 생성/활성화/삭제
  -> account selection 이유 표시
  -> quota/proxy/model cooldown 상태 표시
  -> RTK token saver 절감량 표시
  -> fallback chain / combo policy 편집과 preview
  -> alias / intent mapping 편집
```

### apps/server

local API server입니다.

담당 기능:

- OpenAI-compatible endpoint 제공
- ADK-native endpoint 제공
- router policy 실행
- provider engine 호출
- usage log 저장
- usage log 조회와 summary 제공

초기 endpoint:

```txt
GET  /health
GET  /usage
GET  /v1/usage
GET  /usage/summary
GET  /v1/usage/summary
GET  /usage/:requestId
GET  /providers
GET  /v1/providers
GET  /provider-connections
POST /provider-connections
PUT  /provider-connections/:id
DELETE /provider-connections/:id
GET  /provider-settings
PUT  /provider-settings
GET  /budget
GET  /v1/budget
GET  /oauth/providers
GET  /oauth/start
POST /oauth/callback
GET  /account-selection
GET  /quota
GET  /models/availability
GET  /proxy-pools
GET  /routing-policy
PUT  /routing-policy
POST /routing-policy/combos
DELETE /routing-policy/combos/:comboName
POST /routing-policy/aliases
DELETE /routing-policy/aliases/:aliasName
POST /routing-policy/intents
DELETE /routing-policy/intents/:intentName
POST /routing-policy/preview
GET  /media/routes
GET  /v1/models
POST /v1/chat/completions
POST /v1/embeddings
POST /v1/search
POST /v1/web/fetch
POST /v1/audio/speech
POST /v1/audio/transcriptions
POST /v1/images/generations
```

현재 구현된 외부 LLM endpoint는 `POST /v1/chat/completions`의 non-stream path와 `stream: true` SSE path입니다.
이 경로는 OpenAI-compatible request를 pi `Context`로 변환한 뒤 같은 router/provider/storage 흐름을 사용합니다.
SSE path는 stream 시작 전 실패에 한해 다음 route 후보로 fallback합니다.
이미 chunk가 나간 뒤에는 응답 일관성을 위해 다른 모델로 전환하지 않습니다.

추가로 9router media/tool 계열 endpoint를 server에 연결했습니다.
이 endpoint들은 model alias router가 아니라 provider connection/account selection을 중심으로 동작합니다.

```txt
/v1/embeddings
  -> provider/model 기준 embedding 호출

/v1/search
  -> tavily, brave-search, serper, exa, searxng 계열 검색 호출

/v1/web/fetch
  -> firecrawl, jina-reader, tavily, exa 계열 fetch 호출

/v1/audio/speech
  -> TTS 호출

/v1/audio/transcriptions
  -> STT 호출

/v1/images/generations
  -> image generation 호출
```

### apps/cli

기존 `pi` CLI/TUI 흐름을 우선 보존합니다. `9router` CLI 기능은 필요한 명령만 `pie-lab` 명령 체계에 통합합니다.

초기 명령:

```bash
pie start
pie stop
pie status
pie provider list
pie provider add
pie model list
```

### apps/chat

`pie-chat`을 기반으로 하는 웹 채팅 및 외부 채팅 연결 app입니다.

담당 기능:

- 웹 기반 agent chat UI
- Discord channel 연결
- Telegram DM/group 연결
- 채팅 메시지를 agent input으로 변환
- agent 응답을 채팅 메시지로 전송
- file attachment 송수신
- remote command 처리
- channel/account memory 연결

초기 MVP에는 포함하지 않아도 됩니다. 다만 구조상 `apps/chat`으로 분리해두고, 모든 LLM 호출은 `packages/agent`와 `packages/router`를 통과하도록 설계합니다.

### packages/core

`pi`의 기존 core 타입과 공통 protocol을 기반으로 재구성합니다.

담당 기능:

- message type
- content block
- tool schema
- context
- model selection
- model id
- provider id
- usage type
- error type

이 영역은 다른 패키지가 모두 의존하는 가장 낮은 층입니다.

### packages/runtime

`pi`의 기존 실행 흐름과 session/runtime 기능을 보존하고 재구성하는 영역입니다.

담당 기능:

- session lifecycle
- context persistence
- extension loading
- tool runtime
- 기존 `pi` 사용 흐름과의 호환성
- TUI/CLI에서 공유할 runtime API

`pie-lab`은 `pi`의 일부 provider 코드만 가져오는 프로젝트가 아니므로, runtime 영역을 별도로 두어 기존 `pi` 기능을 최대한 보존합니다.

### packages/providers

`pi/packages/ai`의 provider 구현을 기반으로 합니다.

담당 기능:

- OpenAI
- Anthropic
- Google
- Vertex
- Mistral
- Bedrock
- OpenAI-compatible API
- OpenAI Codex OAuth provider
- GitHub Copilot OAuth provider
- streaming 변환
- tool call 변환
- provider별 option 변환

중요한 원칙은 실제 모델 호출을 여기로 통일하는 것입니다.

### packages/router

`9router`의 라우팅 경험을 흡수하는 영역입니다.

담당 기능:

- provider selection
- model alias
- fallback chain
- quota policy
- cost policy
- account round-robin
- retry policy
- request normalization
- OpenAI-compatible response mapping

router는 provider를 직접 구현하지 않습니다. 어떤 provider와 모델을 사용할지 결정하고, 실제 호출은 `packages/providers`에 위임합니다.

### packages/agent

`pi`의 기존 agent/runtime 흐름을 보존하는 영역입니다.

담당 기능:

- `defineTool`
- tool execution loop
- context persistence
- Agent/AgentHarness 기반 실행 흐름
- skill, prompt-template, extension 연동

기존 coding-agent 실행 경로가 router, quota, usage/cost 기록을 안정적으로 통과하도록 유지합니다.

### packages/storage

로컬 저장소를 담당합니다.

담당 기능:

- provider account
- OAuth token
- API key
- usage log
- request detail
- settings
- agent run history
- chat account/channel config
- chat worker status

초기에는 `9router`의 local DB 구조를 참고하되, storage API를 먼저 분리하는 것이 좋습니다.

### packages/chat

`pie-chat`의 채널 bridge 기능 중 app에 종속되지 않는 공통 로직을 둡니다.

담당 기능:

- chat provider 공통 타입
- incoming message normalization
- outgoing message formatting
- attachment metadata
- chat command parsing
- channel/account memory path 규칙
- secret exchange interface

Discord/Telegram SDK에 직접 의존하는 실행 코드와 웹 chat 실행 코드는 `apps/chat`에 둡니다. `packages/chat`은 agent runtime이 이해할 수 있는 공통 message/event 형태를 제공합니다.

### packages/shared

UI와 server, CLI에서 함께 쓰는 작은 유틸과 상수를 둡니다.

담당 기능:

- provider display metadata
- model category
- pricing metadata
- formatting utility
- validation helper

## 호출 흐름

OpenAI-compatible API 호출은 다음처럼 흐릅니다.

```txt
Client
  -> apps/server /v1/chat/completions
  -> packages/router: policy 적용
  -> packages/router: provider/model/account 선택
  -> packages/providers: 실제 모델 호출
  -> packages/storage: usage/request log 저장
  -> Client
```

현재 `POST /v1/chat/completions` 1차 구현 흐름:

```txt
Client
  -> apps/server /v1/chat/completions
  -> OpenAI messages를 pi Context로 변환
  -> provider-connections settings의 routerPolicy 조회
  -> packages/router: resolvePiModelRoutePlan()
  -> coding-agent ModelRegistry: apiKey/headers 조회
  -> packages/router: RTK token saver payload 압축
  -> packages/providers: completeSimple() 또는 streamSimple()
  -> packages/storage: attempt usage record 저장
  -> OpenAI-compatible response 또는 SSE 반환
```

server의 기본 model/auth 설정 경로:

```txt
~/.pie/agent/models.json
~/.pie/agent/auth.json
```

`PIE_CODING_AGENT_DIR`가 설정되어 있으면 해당 디렉터리의 `models.json`, `auth.json`을 사용합니다.
즉, 기존 pi/coding-agent에서 로그인하거나 설정한 provider 정보를 외부 `/v1` server도 같은 기준으로 사용합니다.

현재 구현된 server 흐름은 usage 조회부터입니다.

```txt
Client
  -> apps/server /usage 또는 /usage/summary
  -> packages/storage: usage.jsonl 읽기
  -> packages/storage: query/summary 계산
  -> Client
```

ADK agent 실행은 다음처럼 흐릅니다.

```txt
CLI or API
  -> packages/agent: agent load
  -> packages/agent: context 생성
  -> packages/router: model 선택
  -> packages/providers: model 호출
  -> packages/agent: tool call 실행
  -> packages/storage: run history 저장
  -> result 반환
```

## 내부/외부 실행 경로

router는 하나만 둡니다. 다만 router로 들어오는 경로는 두 가지입니다.

### 내부 실행

`pi`의 기존 agent/runtime에서 발생한 요청은 HTTP API를 거치지 않고 router package를 직접 호출합니다.

```txt
pi runtime
  -> packages/router
  -> pi provider engine
  -> LLM
```

이 경로에서는 기존 `pi`의 context, tool, stream event, abort/cancel 흐름을 최대한 보존합니다.

### 외부 실행

OpenAI-compatible client는 HTTP API를 통해 들어옵니다.

```txt
OpenAI-compatible HTTP API
  -> apps/server adapter
  -> packages/router
  -> pi provider engine
  -> LLM
```

이 경로에서만 OpenAI-compatible request/response 변환을 수행합니다.

내부 실행과 외부 실행은 진입점만 다르고, model routing 이후에는 같은 router/provider/storage 흐름을 사용합니다.

```txt
internal runtime ┐
                 -> packages/router -> pi provider engine -> packages/storage
external HTTP  ┘
```

현재 내부 실행의 첫 연결은 `packages/coding-agent/src/core/sdk.ts`의 `streamFn` 앞에 들어가 있습니다.

```txt
selected Model
  -> resolvePiModelRoutePlan()
  -> provider-connections settings의 routerPolicy 적용
  -> route plan 순서대로 candidate 선택
  -> resolved Model
  -> modelRegistry auth/header resolution
  -> RTK token saver payload 압축
  -> streamSimple()
  -> UsageStore attempt record 저장
  -> stream 시작 전 실패 시 다음 candidate 시도
```

`pie-lab-router` provider의 가상 모델은 실제 provider가 아닙니다. 예를 들어 `auto:coding`은 실행 직전에 실제 `openai/...`, `anthropic/...`, `google/...` 같은 pi 모델로 바뀐 뒤 기존 provider engine으로 전달됩니다.
`resolvePiModelRoute()`는 호환을 위해 route plan의 첫 번째 후보만 반환합니다.
fallback/ combo 전체 후보가 필요한 실행부는 `resolvePiModelRoutePlan()`을 사용합니다.
이미 stream event가 사용자에게 전달된 뒤에는 transcript가 섞이지 않도록 다음 model로 이어 붙이지 않습니다.

Chat bridge를 통한 agent 실행은 다음처럼 흐릅니다.

```txt
Discord/Telegram
  -> apps/chat: message 수신
  -> packages/chat: message normalize
  -> packages/agent: agent run 생성
  -> packages/router: model/account 선택
  -> packages/providers: model 호출
  -> packages/storage: usage/run/chat log 저장
  -> apps/chat: 응답 전송
```

## 모델 선택과 라우팅 모드

`pi`는 원래 사용자가 provider와 model을 명시하는 SDK에 가깝습니다.

반면 `9router`는 사용자가 요청한 model alias나 combo를 보고 더 적절한 provider, model, account를 선택하는 router에 가깝습니다.

따라서 `pie-lab`에서는 “누가 모델을 결정하는가”를 명확하게 나눠야 합니다. 이 규칙이 없으면 `pi`의 명시적 model 설정과 router의 자동 model 선택이 충돌할 수 있습니다.

### 기본 라우팅 모드

`pie-lab`은 다음 세 가지 model selection mode를 둡니다.

```ts
type RoutingMode = "fixed" | "router" | "fallback";
```

### fixed mode

`fixed`는 agent나 caller가 지정한 model을 반드시 사용하는 모드입니다.

```ts
{
  mode: "fixed",
  model: "openai/gpt-4.1-mini"
}
```

흐름:

```txt
caller가 model 결정
  -> router는 같은 model 안에서 account/credential만 선택
  -> model 변경 금지
```

사용 예:

- 테스트
- 벤치마크
- 특정 model 기능 검증
- 재현성이 중요한 agent
- 반드시 특정 provider/model을 써야 하는 작업

### router mode

`router`는 caller가 구체적인 model을 고르지 않고, 목적이나 alias를 router에 맡기는 모드입니다.

```ts
{
  mode: "router",
  intent: "coding",
  quality: "high",
  budget: "medium"
}
```

또는 간단히 model alias로 표현할 수 있습니다.

```txt
auto:coding
cheap:coding
fast:chat
```

흐름:

```txt
caller는 intent/alias만 전달
  -> router가 provider/model/account 선택
  -> fallback도 router가 처리
```

사용 예:

- 일반 agent 실행
- 사용자가 model을 몰라도 되는 경우
- 비용, 속도, 품질 기준으로 자동 선택하고 싶은 경우
- quota와 fallback을 적극적으로 활용하고 싶은 경우

### fallback mode

`fallback`은 caller가 1순위 model을 지정하되, 실패하거나 quota가 소진되면 router가 대체 model을 선택하는 모드입니다.

```ts
{
  mode: "fallback",
  primary: "anthropic/claude-sonnet-4.5",
  fallback: "auto:coding"
}
```

흐름:

```txt
caller가 primary model 결정
  -> router가 primary + fallback[] 순서의 route plan 계산
  -> 실행부가 primary model 우선 시도
  -> 실패/rate limit/quota 소진 시 route plan의 다음 후보 사용
```

사용 예:

- 선호 model은 있지만 작업이 멈추면 안 되는 경우
- coding tool 연결
- 장시간 agent 실행
- subscription model을 먼저 쓰고, 부족하면 저렴한 API model로 넘기는 경우

### 문자열 namespace 규칙

OpenAI-compatible API처럼 model이 문자열 하나로 들어오는 경우를 위해 namespace 규칙을 둡니다.

```txt
provider/model                 # 명시 model, 기본은 fallback mode
fixed:provider/model           # model 변경 금지
fallback:provider/model        # primary 우선, 실패 시 fallback
auto:coding                    # router mode
cheap:coding                   # router mode
fast:chat                      # router mode
combo:coding                   # router-defined combo
```

현재 `auto:coding` 같은 alias, `auto:chat` 같은 intent, `combo:coding`, structured fallback selection은 route plan으로 해석됩니다.
즉, router는 “어떤 모델을 어떤 순서로 시도할지”를 계산할 수 있습니다.
`coding-agent` SDK 경로에서는 stream 시작 전 실패에 한해 다음 후보로 넘어갑니다.
각 attempt의 성공/실패/중단 결과는 `@pie-lab/storage`의 `UsageStore`에 기록합니다.
dashboard에서는 fallback chain, alias, intent mapping을 편집하고 preview할 수 있습니다.
또한 dashboard는 budget 사용량/소진 여부를 조회하고, `mode: "block"` budget policy는 chat/media 요청 직전에 enforcement됩니다.
Provider login은 기존 token import 방식과 Claude/Codex/Gemini CLI browser redirect 방식을 함께 제공합니다.

기본 해석은 다음처럼 둡니다.

```txt
fixed:*      -> fixed mode
fallback:*   -> fallback mode
auto:*       -> router mode
cheap:*      -> router mode
fast:*       -> router mode
combo:*      -> router mode
provider/model without prefix -> fallback mode
```

`provider/model`의 기본값을 `fallback`으로 두는 이유는 실사용 중 quota, rate limit, provider 장애로 작업이 멈추는 상황을 줄이기 위해서입니다.

재현성이 중요한 경우에는 반드시 `fixed:` prefix나 structured `mode: "fixed"`를 사용합니다.

### 내부 타입 예시

내부에서는 문자열보다 명시적인 구조를 우선합니다.

```ts
type ModelSelection =
  | {
      mode: "fixed";
      model: string;
    }
  | {
      mode: "router";
      intent: string;
      constraints?: {
        maxCost?: number;
        minContextTokens?: number;
        requireTools?: boolean;
        requireVision?: boolean;
        latency?: "low" | "normal";
      };
    }
  | {
      mode: "fallback";
      primary: string;
      fallback?: string | string[];
    };
```

OpenAI-compatible endpoint로 들어온 문자열 model은 server 진입점에서 `ModelSelection`으로 normalize합니다.

## 통합 원칙

### provider 호출은 하나로 통일

`pi`와 `9router`에 provider 호출 로직이 동시에 남아 있으면 유지보수가 어려워집니다.

따라서 실제 model API 호출은 `packages/providers`로 모읍니다.

### router는 policy만 담당

router는 “무엇을 호출할지” 결정합니다.

provider package는 “어떻게 호출할지”를 담당합니다.

### dashboard는 내부 구현을 몰라도 되게 만들기

dashboard는 server API만 호출해야 합니다.

provider 구현 세부사항이나 router 내부 클래스에 직접 의존하지 않는 편이 좋습니다.

### agent runtime은 router를 통해 호출

agent가 provider를 직접 호출하면 fallback, usage logging, quota 정책을 우회하게 됩니다.

따라서 agent runtime은 항상 router를 통해 모델을 호출해야 합니다.

### chat bridge도 router를 우회하지 않는다

`pie-chat` 기반 chat bridge는 외부 채팅 채널을 agent runtime에 연결하는 역할만 담당합니다.

chat bridge가 provider를 직접 호출하면 dashboard usage, quota, fallback, account routing이 빠지게 됩니다. 따라서 chat bridge에서 발생한 모든 LLM 요청도 `packages/agent`와 `packages/router`를 거쳐야 합니다.

### 모델 결정 권한을 명시한다

model routing에서 가장 중요한 규칙은 “누가 model을 결정하는가”입니다.

```txt
fixed    = caller/agent가 model 결정
router   = router가 model 결정
fallback = caller/agent가 primary 결정, router가 예외 상황 결정
```

이 규칙을 모든 API, CLI, dashboard 설정에서 동일하게 사용합니다.

## 초기 패키지 의존 관계

```txt
apps/dashboard -> apps/server API
apps/cli       -> apps/server API, packages/agent
apps/chat      -> packages/chat, packages/agent
apps/server    -> packages/router, packages/agent, packages/storage

packages/agent    -> packages/core, packages/router
packages/runtime  -> packages/core, packages/providers, packages/agent
packages/router   -> packages/core, packages/providers, packages/storage
packages/providers-> packages/core
packages/chat     -> packages/core
packages/storage  -> packages/core
packages/shared   -> packages/core
```
