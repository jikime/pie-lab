# 사용량과 비용 측정

`pie-lab`에서 사용량과 비용 측정의 기준은 router layer입니다.

이유는 단순합니다. 사용자가 요청한 model과 실제로 실행된 model이 다를 수 있기 때문입니다.

예를 들어 사용자는 다음처럼 요청할 수 있습니다.

```txt
auto:coding
```

하지만 router는 실제 상황에 따라 다른 provider와 model을 선택할 수 있습니다.

```txt
anthropic/claude-sonnet-4.5
```

또는 quota, rate limit, provider 장애 때문에 fallback이 발생하면 다음 model로 실행될 수도 있습니다.

```txt
openai/gpt-4.1-mini
```

따라서 비용은 사용자가 요청한 `auto:coding` 기준이 아니라, 실제로 실행된 `resolvedProvider/resolvedModel` 기준으로 계산해야 합니다.

## 핵심 원칙

```txt
Usage source of truth = router layer
Cost calculation basis = resolved provider/model
Requested model = user intent
Resolved model = billing, quota, dashboard, debugging 기준
```

즉, `pie-lab`에서는 다음 원칙을 따릅니다.

- 사용량 기록의 최종 기준은 router layer입니다.
- 비용 계산은 실제 실행된 provider/model 기준입니다.
- 사용자가 요청한 model은 intent로 보존합니다.
- router가 선택한 model은 billing과 dashboard 기준으로 보존합니다.
- fallback이 발생하면 각 attempt를 구분해서 추적합니다.
- provider quota fetcher가 만든 snapshot은 account selection에도 반영합니다.

## Quota-aware account selection

`pie-lab`은 9router의 provider별 quota fetcher 결과를 `provider-connections.json`의
`providerSpecificData.pieLabQuotaSelection`에 저장합니다.

server의 외부 `/v1/chat/completions` 경로는 provider connection 선택 직전에 오래된 quota snapshot을 갱신합니다.
기본값은 다음과 같습니다.

```txt
quotaStrategy = prefer-remaining
quotaRefreshBeforeSelection = true
quotaRefreshTtlMs = 60000
quotaMaxAgeMs = 300000
```

fresh snapshot이 `depleted`이면 해당 connection은 선택에서 제외합니다.
fresh snapshot이 여러 개 있으면 `score`가 높은 connection, 즉 잔여 quota가 높은 connection을 우선합니다.

## pi와 9router의 기존 역할

현재 `pi`와 `9router`에는 모두 사용량/비용과 관련된 코드가 있습니다. 다만 성격이 다릅니다.

### pi

`pi`는 model metadata와 SDK 응답 단위의 비용 계산에 강합니다.

`pi`의 model type에는 다음 정보가 포함됩니다.

```ts
cost: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
```

그리고 usage를 받아 model metadata 기준으로 비용을 계산할 수 있습니다.

```ts
calculateCost(model, usage)
```

따라서 `pi`의 장점은 다음과 같습니다.

- provider별 model metadata가 이미 정리되어 있습니다.
- model별 기본 가격 정보를 가지고 있습니다.
- provider 응답을 SDK의 `AssistantMessage.usage` 형태로 정리할 수 있습니다.
- 단일 model 호출 결과의 usage/cost 계산에 적합합니다.

### 9router

`9router`는 실제 요청 흐름과 dashboard 사용량 기록에 강합니다.

`9router`는 다음 정보를 알고 있습니다.

- 사용자가 요청한 model
- 실제 라우팅된 provider/model
- 사용된 account/connectionId
- fallback 여부
- provider 응답의 token usage
- request log
- dashboard 통계
- pricing override

따라서 `9router`의 장점은 다음과 같습니다.

- 실제로 어떤 provider/model/account가 쓰였는지 압니다.
- usage history를 저장합니다.
- dashboard에서 provider, model, account, endpoint별 통계를 보여줄 수 있습니다.
- 사용자가 pricing을 override할 수 있습니다.
- provider quota나 subscription usage API와 연결할 수 있습니다.

## 통합 후 책임 분리

`pie-lab`에서는 두 프로젝트의 역할을 다음처럼 정리합니다.

```txt
packages/providers
  -> provider 응답에서 raw usage 추출
  -> provider별 token field를 공통 형태로 normalize

packages/router
  -> requestedModel을 resolvedProvider/resolvedModel로 라우팅
  -> 실제 선택된 account/connectionId 기록
  -> fallback attempt 기록

packages/storage
  -> usage history 저장
  -> dashboard 통계용 aggregate 제공

packages/pricing 또는 packages/shared
  -> pi의 model cost metadata 이식
  -> 9router의 pricing override 유지

apps/dashboard
  -> requested model, resolved model, provider, account, token, cost 표시
```

현재 API에서는 두 종류의 usage를 분리합니다.

```txt
GET /usage
GET /usage/summary
  -> pie-lab이 실제 요청 attempt를 기록한 usage history

GET /quota
GET /quota/:connectionId
  -> 9router 방식의 provider connection별 quota/subscription usage 조회

GET /account-selection
  -> 현재 provider/model 기준 account selection 이유 조회

POST /v1/embeddings
POST /v1/search
POST /v1/web/fetch
POST /v1/audio/speech
POST /v1/audio/transcriptions
POST /v1/images/generations
  -> media/tool 호출도 endpoint별 usage record 저장
```

즉 `/usage`는 우리가 실행한 요청 기록이고, `/quota`는 provider 계정 또는 API key 자체의 잔여량 확인입니다.
두 값은 서로 보완 관계이지만 같은 데이터는 아닙니다.

중요한 점은 provider가 비용 기록의 최종 책임자가 아니라는 것입니다.

provider는 응답에서 usage를 추출하고 normalize합니다.
router는 그 usage가 어떤 요청, 어떤 model selection, 어떤 account, 어떤 fallback attempt에서 나온 것인지 알고 있습니다.
storage는 그 결과를 영구 저장하고 dashboard가 볼 수 있게 합니다.

## Usage Record

저장되는 usage record는 최소한 다음 정보를 가져야 합니다.

```ts
type UsageRecord = {
  id: string;
  timestamp: string;

  requestedModel: string;
  routingMode: "fixed" | "router" | "fallback";

  resolvedProvider: string;
  resolvedModel: string;
  connectionId?: string;

  endpoint?: string;
  apiKeyId?: string;
  agentRunId?: string;

  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    totalTokens: number;
    estimated?: boolean;
  };

  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    total: number;
    currency: "USD";
    pricingSource: "pie-metadata" | "override" | "provider" | "estimated" | "unknown";
  };

  tokenSaver?: {
    provider: "rtk";
    bytesBefore: number;
    bytesAfter: number;
    bytesSaved: number;
    hits: number;
    filters: string[];
  };

  status: "success" | "error" | "aborted";
};
```

예시:

```ts
{
  id: "usage_01",
  timestamp: "2026-05-22T12:00:00.000Z",

  requestedModel: "auto:coding",
  routingMode: "router",

  resolvedProvider: "anthropic",
  resolvedModel: "claude-sonnet-4.5",
  connectionId: "account_123",

  endpoint: "/v1/chat/completions",

  usage: {
    input: 10000,
    output: 2000,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 12000
  },

  cost: {
    input: 0.03,
    output: 0.03,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0.06,
    currency: "USD",
    pricingSource: "pie-metadata"
  },

  tokenSaver: {
    provider: "rtk",
    bytesBefore: 120000,
    bytesAfter: 24000,
    bytesSaved: 96000,
    hits: 2,
    filters: ["gitDiff", "searchList"]
  },

  status: "success"
}
```

## RTK token saver

RTK token saver는 9router의 token 절약 계층을 `pie-lab` router에 흡수한 기능입니다.

현재 적용 위치:

```txt
apps/server /v1/chat/completions
packages/coding-agent routed stream
```

압축 대상:

- OpenAI tool message
- OpenAI Responses function output
- Claude tool result block
- Kiro-style tool result block

현재 filter:

- `gitDiff`
- `gitStatus`
- `searchList`
- `smartTruncate`

RTK는 기본 활성화입니다. 임시로 끄고 싶다면 다음 환경변수를 사용합니다.

```bash
PIE_LAB_RTK_ENABLED=false
```

RTK가 동작하면 usage record의 `tokenSaver`에 절감 byte와 filter 목록이 저장되고, dashboard의 최근 요청 표와 summary card에서 확인할 수 있습니다.

## Media/tool usage

embedding, web search/fetch, TTS/STT, image generation도 같은 usage store에 저장합니다.

이 endpoint들은 chat model router alias보다 provider connection 선택이 더 중요합니다. 따라서 요청은 보통 다음처럼 provider를 명시합니다.

```json
{
  "model": "openai/text-embedding-3-small",
  "input": "hello"
}
```

또는 web search/fetch처럼 provider만 지정합니다.

```json
{
  "provider": "tavily",
  "query": "pie-lab router"
}
```

저장되는 usage record의 기준:

```txt
requestedModel = 요청한 provider/model 또는 provider
resolvedProvider = 실제 credential이 선택된 provider
resolvedModel = 실제 model 또는 기능명
endpoint = /v1/embeddings, /v1/search 등
connectionId = 선택된 provider connection
```

## requestedModel과 resolvedModel

`requestedModel`은 사용자가 요청한 값입니다.

```txt
auto:coding
fixed:openai/gpt-4.1-mini
fallback:anthropic/claude-sonnet-4.5
```

`resolvedModel`은 router가 실제로 실행한 model입니다.

```txt
claude-sonnet-4.5
gpt-4.1-mini
gemini-2.5-pro
```

이 둘을 모두 저장해야 합니다.

이유는 다음과 같습니다.

- 사용자는 자신이 어떤 intent를 요청했는지 확인할 수 있습니다.
- dashboard는 실제 비용을 발생시킨 model을 보여줄 수 있습니다.
- fallback이 발생했을 때 어떤 model로 넘어갔는지 추적할 수 있습니다.
- routing policy를 개선할 때 근거 데이터로 사용할 수 있습니다.

## Fallback Attempt 기록

fallback이 발생하면 최종 성공 record만 남기면 안 됩니다.

실패한 attempt도 최소한의 정보는 남겨야 합니다.

```ts
type RoutingAttempt = {
  index: number;
  provider: string;
  model: string;
  connectionId?: string;
  status: "success" | "error" | "skipped";
  errorCode?: string | number;
  errorMessage?: string;
  usage?: UsageRecord["usage"];
  cost?: UsageRecord["cost"];
};
```

예시:

```ts
{
  requestedModel: "fallback:anthropic/claude-sonnet-4.5",
  routingMode: "fallback",
  attempts: [
    {
      index: 0,
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      connectionId: "anthropic_account_1",
      status: "error",
      errorCode: 429,
      errorMessage: "rate limit"
    },
    {
      index: 1,
      provider: "openai",
      model: "gpt-4.1-mini",
      connectionId: "openai_account_1",
      status: "success",
      usage: {
        input: 10000,
        output: 2000,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12000
      }
    }
  ]
}
```

최종 비용 집계에는 성공한 attempt의 비용을 반영합니다.
단, provider가 실패 응답에서도 과금 가능한 usage를 반환하는 경우에는 해당 usage도 별도 기록할 수 있어야 합니다.

현재 구현 상태:

```txt
@pie-lab/storage
  -> UsageRecord / UsageStore 정의
  -> InMemoryUsageStore 제공
  -> JsonlUsageStore 제공
  -> queryUsageRecords() 제공
  -> summarizeUsageRecords() 제공

coding-agent SDK routed stream
  -> route attempt success/error/aborted 기록
  -> 기본 저장 위치: agentDir/usage.jsonl

@pie-lab/server
  -> GET /usage
  -> GET /v1/usage
  -> GET /usage/summary
  -> GET /v1/usage/summary
  -> POST /v1/chat/completions attempt 기록
  -> POST /v1/chat/completions stream:true attempt 기록
```

현재 dashboard는 usage summary, provider/model 집계, 최근 record, request detail/fallback timeline, provider quota connection 상태, 선택한 connection의 quota 상세값, budget 사용/소진 상태를 표시합니다.
account/quota 정책은 quota selection snapshot을 통해 account selection에 반영됩니다. budget policy는 `provider-settings`에 저장되며, `mode: "block"`이면 chat/media 요청 직전에 차단됩니다. 차단된 attempt는 `status: "skipped"`, `errorCode: "budget_limit_exceeded"` usage record로 남습니다.

Budget 상태 조회:

```txt
GET /budget
GET /v1/budget
GET /budget?provider=anthropic
```

## Usage 조회 API

`apps/server`는 현재 JSONL usage store를 읽어서 조회 API를 제공합니다.

기본 저장 위치:

```txt
1. PIE_LAB_USAGE_PATH
2. PIE_CODING_AGENT_DIR/usage.jsonl
3. ~/.pie/agent/usage.jsonl
```

최근 record 조회:

```txt
GET /usage
GET /v1/usage
```

summary 조회:

```txt
GET /usage/summary
GET /v1/usage/summary
```

request detail / fallback timeline 조회:

```txt
GET /usage/:requestId
GET /v1/usage/:requestId
```

지원하는 query parameter:

```txt
provider
model
status
routingMode
requestId
agentRunId
endpoint
from
to
limit
order=asc|desc
```

예:

```bash
curl "http://127.0.0.1:4873/usage?provider=anthropic&limit=20"
curl "http://127.0.0.1:4873/usage/summary?from=2026-05-22T00:00:00Z"
```

이 API는 dashboard가 붙기 전까지 사용량을 확인하는 최소 표면입니다.
현재 `apps/dashboard`의 usage 화면은 이 API를 읽어서 summary, provider/model 집계, 최근 record, request detail timeline을 보여줍니다.
provider quota는 `/quota`, `/quota/:connectionId`를 별도로 읽으며, 상세값은 사용자가 선택한 connection만 조회합니다.

외부 OpenAI-compatible 호출도 같은 usage record를 남깁니다.

```txt
POST /v1/chat/completions
  -> requestedModel: request.body.model
  -> resolvedProvider/resolvedModel: router route plan 결과
  -> apiKey/headers: coding-agent ModelRegistry/AuthStorage 기준
  -> endpoint: /v1/chat/completions
```

현재는 non-stream 응답과 `stream: true` SSE 응답을 모두 1차 지원합니다.
streaming 경로에서도 final `done` 또는 `error` event를 기준으로 attempt record를 남깁니다.

streaming fallback 기준:

```txt
SSE chunk 전송 전 실패
  -> 다음 route 후보 시도

SSE chunk 전송 후 실패
  -> 다른 model로 전환하지 않음
  -> error SSE 전송 후 종료
```

이 기준을 두는 이유는 이미 사용자에게 일부 답변이 전달된 뒤 다른 모델의 답변을 이어 붙이면 transcript와 비용 기록이 섞일 수 있기 때문입니다.

## Pricing Source 우선순위

비용 계산에 사용할 가격 정보는 다음 순서로 찾습니다.

```txt
1. user pricing override
2. provider-specific pricing override
3. pi model metadata
4. pattern/default pricing
5. unknown
```

초기 MVP에서는 다음 두 가지를 우선 지원합니다.

- `pi`의 model metadata
- `9router`의 pricing override

가격 정보를 찾지 못한 경우 cost는 `0`으로 조용히 처리하지 말고, `pricingSource: "unknown"`으로 남깁니다.

```ts
cost: {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  currency: "USD",
  pricingSource: "unknown"
}
```

dashboard에서는 이 record를 “가격 정보 없음”으로 표시하는 편이 좋습니다.

## Usage가 없는 provider 응답

일부 provider나 proxy는 usage 정보를 반환하지 않을 수 있습니다.

이 경우 가능한 선택지는 세 가지입니다.

```txt
1. estimated usage로 저장
2. usage unknown으로 저장
3. 요청/응답 문자 수만 참고 데이터로 저장
```

초기 기본값은 `unknown`입니다.

추정 계산은 편리하지만, 실제 비용과 차이가 날 수 있습니다. 따라서 추정값을 저장할 때는 반드시 표시해야 합니다.

```ts
usage: {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  estimated: true
}
```

## Dashboard 표시 기준

dashboard에서는 requested model과 resolved model을 함께 보여줘야 합니다.

예시:

```txt
Requested: auto:coding
Resolved:  anthropic/claude-sonnet-4.5
Account:   anthropic_account_1
Tokens:    10,000 in / 2,000 out
Cost:      $0.0600
```

fallback이 발생한 경우에는 attempt 흐름을 볼 수 있어야 합니다.

```txt
1. anthropic/claude-sonnet-4.5 -> 429 rate limit
2. openai/gpt-4.1-mini         -> success
```

이렇게 해야 사용자가 router가 왜 특정 model을 선택했는지 이해할 수 있습니다.

## Quota Snapshot과 Account Scoring

quota 값은 단순 표시용만이 아니라 account selection에도 사용합니다.

현재 구현 기준은 다음과 같습니다.

```txt
provider quota fetcher
  -> ProviderUsageResult
  -> providerSpecificData.pieLabQuotaSelection snapshot
  -> @pie-lab/router selectProviderConnection()
  -> quota-aware account selection
```

저장되는 snapshot은 대략 다음 의미를 갖습니다.

```ts
{
  checkedAt: "2026-05-23T00:00:00.000Z",
  status: "available" | "depleted" | "error" | "unknown",
  score: 0.82,
  remainingPercentage: 82,
  resetAt: "2026-05-23T09:00:00.000Z"
}
```

기본 정책은 `prefer-remaining`입니다.

- quota snapshot이 fresh하면 잔여량이 높은 account를 우선합니다.
- snapshot이 `depleted`이면 해당 account는 선택에서 제외됩니다.
- snapshot refresh가 실패하면 요청을 중단하지 않고 `error` 상태로 저장합니다.
- 오래된 snapshot은 `quotaMaxAgeMs` 기준으로 selection 점수에서 제외됩니다.
- 선택 직전 refresh는 `quotaRefreshBeforeSelection`과 `quotaRefreshTtlMs`로 제어합니다.

이 로직은 이제 `@pie-lab/shared`에 있고, server API와 내부 coding-agent 실행이 같은 구현을 사용합니다.

## 테스트 시나리오

사용량/비용 측정은 다음 시나리오를 기준으로 테스트합니다.

- `auto:coding` 요청이 실제 `anthropic/claude-sonnet-4.5`로 라우팅되면 비용은 resolved model 기준으로 계산됩니다.
- `fixed:openai/gpt-4.1-mini` 요청은 requested model과 resolved model이 동일하게 저장됩니다.
- `fallback:anthropic/claude-sonnet-4.5` 요청에서 primary가 실패하면 성공한 fallback model 기준으로 비용이 계산됩니다.
- pricing override가 있으면 `pi` model metadata보다 override 가격이 우선 적용됩니다.
- provider 응답에 usage가 없으면 `pricingSource` 또는 `usage.estimated` 상태로 dashboard에서 구분됩니다.
- streaming 응답에서도 최종 usage가 저장됩니다.
- aborted 요청은 성공 요청과 구분되어 저장됩니다.

## 결론

`pie-lab`에서 사용량 측정은 router layer가 책임지는 것이 맞습니다.

`pi`는 model metadata와 provider usage normalization에 강하고, `9router`는 실제 routing 결과와 dashboard usage history에 강합니다.

따라서 통합 방향은 다음과 같습니다.

```txt
pi model metadata
  -> 기본 가격 정보로 활용

9router usage tracking
  -> 실제 사용량 기록과 dashboard 기준으로 활용

router resolved model
  -> 비용 계산의 기준
```

이 구조를 따르면 `auto:*`, `combo:*`, `fallback:*` 같은 router 중심 model selection에서도 비용과 사용량을 정확하게 추적할 수 있습니다.
