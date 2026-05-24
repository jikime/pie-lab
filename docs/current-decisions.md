# 현재 결정 사항

이 문서는 지금까지 논의한 `pie-lab`의 핵심 결정 사항을 한곳에 정리합니다.

## 1. 프로젝트의 기준

`pie-lab`은 별도 git repository로 만듭니다.

다만 빈 코드베이스에서 시작하지 않습니다. `pie-lab` repository의 초기 코드베이스는 `pi` 소스를 그대로 사용합니다.

그 위에 `9router`와 `pie-chat`을 통합하고, 이후 개인 workflow에 맞게 커스터마이징해 나만의 Agentic Development Kit로 발전시킵니다.

```txt
pie-lab
  = pi source baseline
  + 9router routing/operations
  + pie-chat chat bridge
  + custom agentic development layer
```

## 2. fork와 remote

세 프로젝트는 모두 fork를 기준으로 추적합니다.

현재 사용하는 fork 주소는 다음과 같습니다.

```txt
pi       https://github.com/jikime/pi
9router  https://github.com/jikime/9router
pie-chat  https://github.com/jikime/pi-chat
```

`pie-lab` repository에는 다음 remote를 등록했습니다.

```txt
pi-fork      https://github.com/jikime/pi
router-fork  https://github.com/jikime/9router
chat-fork    https://github.com/jikime/pi-chat
```

`pie-lab` 자체의 GitHub repository가 만들어지면 `origin` remote를 추가합니다.

```bash
git remote add origin <pie-lab-repo-url>
```

## 3. 현재 코드베이스 상태

현재 `pie-lab/`는 `pi` 소스를 기반으로 만들어졌습니다.

즉, `pi` 소스가 별도 하위 폴더에 들어간 것이 아니라, `pie-lab` 루트 전체가 `pi` 기반 코드베이스입니다.

예:

```txt
pie-lab/packages/ai
pie-lab/packages/agent
pie-lab/packages/coding-agent
pie-lab/packages/tui
pie-lab/packages/web-ui
pie-lab/scripts
pie-lab/.pie
```

추가로 통합을 위해 다음 구조를 만들었습니다.

```txt
apps/
  dashboard/
  server/
  chat/

packages/
  router/
  storage/
  chat/
  shared/

docs/
```

`9router`와 `pie-chat`의 실제 소스는 아직 통째로 import하지 않았습니다. 현재는 통합될 위치와 패키지 경계만 먼저 잡은 상태입니다.

## 3-1. 패키지 스코프

`pie-lab` 저장소 안에서 사용자와 개발자가 직접 보게 되는 workspace/package 이름은 `@pie-lab/*`로 정리합니다.

초기 가칭은 `pie-adk`였지만, `pielab.ai` 도메인과 앞으로의 제품 범위를 고려해 프로젝트 이름과 package scope를 `pie-lab`, `@pie-lab/*`로 변경합니다. ADK는 프로젝트 이름에 고정하지 않고 “Agentic Development Kit”이라는 설명으로 사용합니다.

현재 기준 mapping은 다음과 같습니다.

```txt
@earendil-works/pi-ai           -> @pie-lab/ai
@earendil-works/pi-agent-core   -> @pie-lab/agent-core
@earendil-works/pi-coding-agent -> @pie-lab/coding-agent
@earendil-works/pi-tui          -> @pie-lab/tui
@earendil-works/pi-web-ui       -> @pie-lab/web-ui
```

따라서 앞으로 workspace 명령은 다음처럼 사용합니다.

```bash
npm --workspace @pie-lab/coding-agent test
npm --workspace @pie-lab/coding-agent run build
npm --workspace @pie-lab/ai run build
```

사용자에게 안내할 공식 설치 명령은 다음으로 고정합니다.

```bash
npm install -g --ignore-scripts @pie-lab/coding-agent
pie
```

`npm install -g --ignore-scripts pie-lab/pie-coding-agent` 같은 형태는 npm registry package가 아니라 GitHub shorthand로 해석되므로 공식 설치 경로로 사용하지 않습니다. 공개 배포와 업데이트 안내, 문서, self-update를 모두 npm scoped package인 `@pie-lab/coding-agent` 기준으로 맞춥니다.

이 설치가 동작하려면 `@pie-lab/coding-agent`뿐 아니라 런타임 의존 패키지인 `@pie-lab/ai`, `@pie-lab/agent-core`, `@pie-lab/tui`, `@pie-lab/router`, `@pie-lab/storage`, `@pie-lab/shared`도 npm에 public package로 배포되어야 합니다.

`pie` 내부의 self-update 안내도 npm 방식에서는 같은 명령 형태를 사용합니다. 즉 사용자가 나중에 업데이트 안내를 보더라도 `npm install -g --ignore-scripts @pie-lab/coding-agent` 기준으로 표시됩니다.

이 변경은 `pie-lab`이 `pi` 소스를 기반으로 하지만, 앞으로는 별도 통합 ADK로 커스터마이징된다는 방향을 명확히 하기 위한 것입니다.

## 3-2. CLI 명령어

터미널에서 직접 실행하는 CLI 명령어는 `pie`로 정합니다.

이유는 다음과 같습니다.

- 기존 `pi` 명령과 충돌하지 않습니다.
- `pie-lab`의 `pi` 의미인 Passive Income과 연결됩니다.
- `pie`는 짧고 기억하기 쉬워서 매일 쓰는 CLI 명령으로 부담이 적습니다.

따라서 기존 `pi` 소스 구조는 기반으로 삼되, 사용자가 접하는 앱 이름과 실행 명령은 다음처럼 `pie`로 정리합니다.

```bash
pie
pie -p "Summarize this codebase"
pie start
pie provider list
```

앱 내부 이름도 `pie`로 정합니다. 그래서 `APP_NAME`, TUI 제목, debug log 이름, 기본 설정 경로, 프로젝트 설정 경로, 앱 전용 환경변수는 모두 `pie` 기준으로 동작합니다.

```txt
APP_NAME                    pie
CLI command                 pie
global config dir           ~/.pie/agent
project config dir          .pie/
agent dir env               PIE_CODING_AGENT_DIR
session dir env             PIE_CODING_AGENT_SESSION_DIR
package dir env             PIE_PACKAGE_DIR
offline env                 PIE_OFFLINE
```

기존 `pi`에서 쓰던 `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_PACKAGE_DIR`, `PI_OFFLINE` 같은 일부 환경변수는 개발 중 마이그레이션 편의를 위해 fallback으로만 허용합니다. 새 문서와 새 사용법에서는 `PIE_*`를 우선 사용합니다.

현재는 기존 `pie` CLI, `-p` 실행, skill, extension, prompt-template, `@pie-lab/agent-core`의 Agent/AgentHarness 흐름을 우선 사용합니다.

## 3-3. 대표 색상

Pie Lab의 대표 색상은 `Pie Lab Blue + Cyan`으로 고정합니다.

```txt
Primary Blue  #2563EB
Deep Blue     #1D4ED8
Cyan Accent   #06B6D4
Mint Status   #10B981
Slate Text    #111827 / #E2E8F0
```

이 색상은 Pio 캐릭터의 파랑/시안 계열과 맞추고, 라이트/다크 터미널에서도 읽히는 것을 우선합니다.

CLI 시작 헤더는 이 팔레트를 기준으로 라이트/다크 터미널을 감지해 다른 색상 값을 사용합니다. 또한 80컬럼 터미널에서도 줄바꿈으로 깨지지 않도록 박스 폭을 자동 조정합니다. Dashboard, Pie Chat, 문서 이미지도 앞으로 이 색상 체계에 맞춥니다.

## 4. pi의 역할

`pi`는 일부 provider 코드만 가져오는 대상이 아닙니다.

`pie-lab`은 `pi`의 전체 기능과 기존 사용 흐름을 기반으로 합니다.

보존 대상:

- `packages/ai`
- `packages/agent`
- `packages/coding-agent`
- `packages/tui`
- `packages/web-ui`
- 기존 scripts
- 기존 `.pi` 구조에서 이전된 `.pie` 설정 구조
- 기존 CLI/TUI workflow

원칙:

```txt
pi의 기능을 먼저 보존한다.
그 위에 router, dashboard, chat bridge를 통합한다.
```

## 5. 9router의 역할

`9router`는 fork로 추적하되, `pie-lab` 안에서는 독립 제품처럼 통째로 유지하지 않습니다.

대신 기능 단위로 `pi` runtime 안에 흡수합니다.

```txt
9router fork
  -> 원본 추적, 업데이트 비교, 필요 시 PR용

pie-lab/packages/router
  -> routing, fallback, model alias, account selection, quota policy

pie-lab/packages/storage
  -> provider account, usage history, request detail, pricing override

pie-lab/apps/server
  -> OpenAI-compatible local API

pie-lab/apps/dashboard
  -> provider, routing, usage, request log dashboard
```

중요한 원칙:

```txt
9router가 pi의 LLM 호출 흐름을 대체하지 않는다.
pi의 호출 흐름 앞에 router layer가 들어간다.
```

목표 흐름:

```txt
pi agent/runtime
  -> model selection
  -> pie-lab router
  -> pi provider engine
  -> usage/cost tracking
```

## 5-1. dashboard 기술 방향

기존 `apps/dashboard`는 Vite 기반 단일 페이지 대시보드로 유지합니다.

다만 앞으로의 제품형 대시보드는 `apps/dashboard-next`에서 Next.js 16, Tailwind CSS 4, shadcn/ui 기반으로 다시 구성합니다.

이유:

- 9router 원본처럼 메뉴별 페이지 구조를 만들기 쉽습니다.
- routing, providers, usage, quota, media, proxy, logs, settings를 App Router 경로로 자연스럽게 분리할 수 있습니다.
- shadcn/ui는 컴포넌트 코드가 프로젝트 내부에 들어오기 때문에 `pie-lab` 스타일로 커스터마이징하기 좋습니다.
- 기존 Vite 대시보드를 바로 덮어쓰지 않고, 새 대시보드를 검증한 뒤 단계적으로 교체할 수 있습니다.

현재 기준:

```txt
apps/dashboard       기존 Vite dashboard, 유지
apps/dashboard-next  Next.js 16 + Tailwind 4 + shadcn/ui dashboard, 신규 개발
```

`apps/dashboard-next`에는 usage detail/fallback timeline/raw trace, origin/endpoint별 usage 집계, provider connection CRUD, OAuth redirect login, provider별 setup guide, quota detail, model availability cooldown clear, routing policy form, budget form, proxy pool update/delete/binding, media endpoint test form이 들어갔습니다.

root build에 포함할지는 별도 결정하며, 지금은 아래처럼 독립 실행합니다.

`dashboard-next`의 기본 실행 주소는 다음입니다.

```txt
http://127.0.0.1:4876
```

API 서버 기본 주소는 다음입니다.

```txt
http://127.0.0.1:4873
```

## 5-2. 9router의 account 의미

`9router`에서 routing/fallback 문맥에 나오는 `account`는 보통 9router 자체의 회원가입 계정을 뜻하지 않습니다.

이 문맥의 account는 각 LLM provider에 연결된 인증 정보, 즉 `provider connection`에 가깝습니다.

예:

```txt
OpenAI API key 1개
Anthropic OAuth 로그인 1개
Claude 구독 계정 OAuth 1개
Gemini API key 1개
같은 provider에 등록한 두 번째 API key
```

따라서 `pie-lab` 문서와 코드에서는 혼동을 줄이기 위해 다음 용어를 우선 사용합니다.

```txt
provider connection = provider 인증 연결
account selection   = provider connection 선택
connectionId        = 실제 선택된 인증 연결 ID
```

별도로 9router dashboard 접근을 보호하는 `requireLogin`, `authMode`, OIDC 설정은 관리자 화면 보안용 로그인입니다.
이것은 모델 라우팅에서 말하는 provider connection과 다른 개념입니다.

## 6. pie-chat의 역할

`pie-chat`은 Discord/Telegram 같은 외부 채팅 채널을 `pie-lab` agent runtime과 연결하는 chat bridge로 통합합니다.

```txt
pie-chat fork
  -> 원본 추적, 업데이트 비교, 필요 시 PR용

pie-lab/packages/chat
  -> chat provider 공통 타입, message normalization, attachment metadata

pie-lab/apps/chat
  -> web chat UI, Discord/Telegram bot 실행, channel 연결, remote command 처리
```

중요한 원칙:

```txt
chat bridge는 LLM provider를 직접 호출하지 않는다.
모든 요청은 pie-lab agent/runtime과 router를 거친다.
```

목표 흐름:

```txt
Discord/Telegram
  -> chat bridge
  -> pie-lab agent runtime
  -> pie-lab router
  -> pi provider engine
  -> usage/cost tracking
```

## 7. 모델 선택과 router 충돌 해결

`pi`는 원래 model을 명시하는 흐름이 강하고, `9router`는 최적 model/account를 선택하는 흐름이 강합니다.

충돌을 막기 위해 모델 선택 권한을 세 가지 mode로 나눕니다.

```txt
fixed    = caller/agent가 model 결정, router는 model 변경 금지
router   = router가 intent/alias를 보고 model 결정
fallback = caller/agent가 primary model 결정, 실패 시 router가 대체
```

문자열 규칙:

```txt
fixed:openai/gpt-4.1-mini
fallback:anthropic/claude-sonnet-4.5
auto:coding
cheap:coding
fast:chat
combo:coding
openai/gpt-4.1-mini  # 기본 fallback mode
```

## 8. 사용량과 비용 측정

사용량과 비용 측정의 source of truth는 router layer입니다.

이유는 실제 실행된 model은 사용자가 요청한 model과 다를 수 있기 때문입니다.

예:

```txt
requestedModel = auto:coding
resolvedModel  = anthropic/claude-sonnet-4.5
```

비용은 `requestedModel`이 아니라 실제 실행된 `resolvedProvider/resolvedModel` 기준으로 계산합니다.

원칙:

```txt
Usage source of truth = router layer
Cost calculation basis = resolved provider/model
Requested model = user intent
Resolved model = billing, quota, dashboard, debugging 기준
```

`pi`의 model metadata와 cost 정보는 기본 pricing source로 활용하고, `9router`의 pricing override와 usage dashboard 흐름을 통합합니다.

## 9. 현재 추가된 구조

현재 추가된 통합용 파일과 디렉터리는 다음과 같습니다.

```txt
apps/README.md
apps/dashboard/
apps/server/
apps/chat/

packages/router/
packages/storage/
packages/chat/
packages/shared/

docs/
```

root `package.json`에는 `apps/*` workspace를 추가했습니다.

root package name은 `pie-lab`으로 변경했습니다.

## 10. 다음 단계

다음 작업은 기능을 크게 가져오기보다, 작은 흐름 하나를 먼저 연결하는 것이 좋습니다.

추천 순서:

```txt
1. pi baseline build/test 확인
2. packages/router에 model selection parser 구현
3. pi의 model 호출 직전에 router.resolve()를 연결할 위치 찾기
4. fixed/router/fallback mode 최소 동작 구현
5. packages/storage에 usage record 저장 인터페이스 구체화
6. apps/server에 usage 조회 API 구현
7. apps/server에 /v1/chat/completions 최소 endpoint 구현
8. 이후 9router dashboard 일부를 apps/dashboard로 이식
9. 이후 pie-chat text-only bridge를 apps/chat으로 이식
```

초기 목표는 다음 한 가지입니다.

```txt
pie-lab에서 auto:coding 요청이 router를 거쳐 실제 pi provider model로 실행되고,
resolved model 기준으로 usage/cost record가 남는 것.
```

## 11. 내부/외부 호출 경로

`pie-lab`은 router를 넣더라도 모든 호출을 HTTP API로 우회하지 않습니다.

호출 경로는 내부 실행과 외부 호환성 실행으로 나눕니다.

### 내부 실행

`pi`의 기존 agent/runtime에서 실행되는 요청은 router package를 직접 호출합니다.

```txt
pi runtime
  -> packages/router
  -> pi provider engine
  -> LLM
```

이 경로에서는 `pi`의 기존 context, tool, stream event, usage 구조를 최대한 유지합니다.

목표:

- local HTTP hop 제거
- OpenAI format 변환 최소화
- streaming event 순서 보존
- abort/cancel 흐름 보존
- 기존 `pi` 입력 방식 유지

### 외부 실행

Codex, Claude Code, Cursor, Cline, OpenAI-compatible client 같은 외부 도구는 HTTP API를 통해 들어옵니다.

```txt
OpenAI-compatible HTTP API
  -> apps/server adapter
  -> packages/router
  -> pi provider engine
  -> LLM
```

이 경로에서만 OpenAI-compatible request/response 변환을 수행합니다.

목표:

- `/v1/chat/completions` 같은 외부 호환 endpoint 제공
- 외부 request를 `pi` context/tool 형식으로 변환
- 내부와 같은 router/usage path 사용
- dashboard에서 내부/외부 요청을 같은 기준으로 추적

### 공통 원칙

두 경로는 진입점만 다르고, model routing 이후에는 같은 흐름을 사용합니다.

```txt
internal runtime ┐
                 -> packages/router -> pi provider engine -> usage/cost tracking
external HTTP  ┘
```

따라서 router는 하나만 둡니다. 내부용 router와 외부용 router를 따로 만들지 않습니다.

## 12. 9router 라우팅 기능 이식 기준

현재 `9router`의 실제 라우팅 코드가 `pie-lab`에 완전히 들어온 상태는 아닙니다.

현재 완료된 것은 다음입니다.

```txt
- pi source 기반 pie-lab repo 구성
- 9router fork remote 등록
- pie-chat fork remote 등록
- packages/router 자리 생성
- packages/router의 fixed/router/fallback parser 구현
- packages/router의 pi model catalog resolver 구현
- packages/router의 route plan 계산 구현
- auto:coding, cheap:coding, fast:chat 같은 router alias 가상 모델 추가
- combo:coding alias를 여러 후보 route plan으로 해석
- structured fallback selection의 primary + fallback[] 후보 해석
- combo:* alias의 기본 상위 후보 route plan 생성
- coding-agent SDK streamFn에서 route plan 순서 기반 fallback 1차 실행
- packages/storage의 UsageStore/JSONL usage record 구현
- coding-agent SDK streamFn에서 fallback attempt success/error/aborted record 저장
- packages/storage의 usage query/summary 유틸 구현
- apps/server의 usage 조회 API 구현
- apps/server의 OpenAI-compatible `/v1/models` 구현
- apps/server의 OpenAI-compatible `/v1/chat/completions` non-stream 1차 구현
- apps/server의 OpenAI-compatible `/v1/chat/completions` streaming/SSE 1차 구현
- apps/server의 `coding-agent` AuthStorage/ModelRegistry 통합 1차 구현
- apps/server의 provider/auth 상태 API 1차 구현
- apps/server의 provider quota API 1차 구현
- apps/dashboard의 usage 조회 화면 1차 구현
- apps/dashboard의 provider/auth 상태 화면 1차 구현
- apps/dashboard의 provider quota connection 상태 화면 1차 구현
- apps/dashboard의 provider quota 상세 수동 조회 화면 1차 구현
- packages/storage의 provider connection/settings store 1차 구현
- packages/storage의 proxy pool store 1차 구현
- packages/router의 provider account selection helper 1차 구현
- apps/server quota API의 9router proxy pool 해석 연결
- apps/server의 proxy pool 관리 API 1차 구현
- apps/server의 provider connection proxy pool 지정 API 1차 구현
- apps/dashboard의 proxy pool 관리/지정 UI 1차 구현
- apps/server의 provider connection 관리 API 구현
- apps/dashboard의 provider connection 생성/활성화/삭제 UI 구현
- apps/server의 account selection 설명 API 구현
- apps/dashboard의 account selection 이유 화면 구현
- usage/cost dashboard에 endpoint, routeSource, connectionId, RTK 절감량 표시
- RTK token saver를 router, server, coding-agent SDK 경로에 연결
- compaction/auto-compaction 보조 LLM 호출의 router 경유 연결
- embedding, web search/fetch, TTS/STT, image generation endpoint 구현
- provider-connections settings에 routerPolicy 저장 구조 추가
- routing policy API와 dashboard fallback chain 편집 화면 구현
- routing policy API와 dashboard alias/intent mapping 편집 화면 구현
- OAuth token import wizard 구현
- provider-settings API와 budget/quota 정책 편집 화면 구현
- budget status API와 chat/media budget enforcement 구현
- Claude/Codex/Gemini CLI browser redirect OAuth login wizard 구현
- provider health dashboard 고도화
- media routes API, media alias, extra_body passthrough 구현
- media endpoint provider coverage 확대
- provider health deep probe API와 dashboard 표시 구현
- usage request detail API와 fallback timeline dashboard 구현
- request detail raw event trace 저장과 dashboard 표시 구현
- routing policy import/export, combo reorder, model suggestion 구현
- server와 coding-agent 내부 routed stream에서 저장된 routerPolicy 적용
- provider reset time 기반 quota/rate-limit cooldown 반영
- apps/server의 model availability/cooldown API 1차 구현
- apps/dashboard의 model cooldown 현황 화면 1차 구현
- 9router 방식의 model cooldown 수동 해제 API와 dashboard 버튼 구현
- coding-agent 내부 streamFn 앞에 router.resolve() 연결
- branch summary 기본 호출 앞에 router.resolve() 연결
- packages/storage 자리 생성
- apps/server 자리 생성
- apps/dashboard 자리 생성
- 내부/외부 호출 경로 설계
```

아직 해야 할 것은 다음입니다.

```txt
- pie-chat bridge 장시간 실사용 검증
- chat-origin usage/cost dashboard 구분 고도화
- dashboard-next의 기존 dashboard 기능 완전 이관
- 설치와 실행 흐름 안정화
```

`9router`에서 우선 가져올 기능은 executor 전체가 아닙니다.

우선순위:

```txt
1. model alias / combo 해석
2. fixed/router/fallback routing mode 처리
3. requestedModel -> resolvedProvider/resolvedModel 변환
4. fallback/ combo route plan 계산
5. provider account selection
6. route plan 순서 기반 fallback 실행
7. quota/rate-limit handling
8. usage/cost tracking
9. pricing override
```

피해야 할 구조:

```txt
pi
  -> HTTP /v1
  -> 9router handler
  -> 9router executor
  -> LLM
```

이 구조는 `pi` provider engine과 9router executor가 중복됩니다.

목표 구조:

```txt
pi
  -> router.resolve()
  -> pi provider engine
  -> LLM
```

## 13. "라우팅 기능이 들어갔다"의 완료 기준

다음 조건이 충족되면 `9router`의 모델 라우팅 기능이 `pie-lab`에 제대로 들어갔다고 봅니다.

```txt
1. packages/router가 auto:coding 같은 alias를 해석한다.
2. fixed/router/fallback mode를 처리한다.
3. router.resolve()가 resolvedProvider/resolvedModel/connectionId를 반환한다.
4. pi 내부 호출이 router.resolve() 결과를 사용한다.
5. 외부 /v1 요청도 같은 router.resolve()를 사용한다.
6. fallback 성공/실패 attempt가 기록된다.
7. resolved model 기준으로 usage/cost record가 남는다.
```

현재는 1, 2, 3, 4의 내부 호출 일부와 6, 7의 1차 구현이 완료되어 있습니다.
`resolvePiModelRoutePlan()`도 추가되어 fallback/ combo 후보 목록을 계산할 수 있고,
`coding-agent` SDK의 일반 stream 경로에서는 stream 시작 전 실패 시 다음 후보로 넘어갈 수 있습니다.
또한 해당 route attempt의 성공/실패/중단 결과는 `UsageStore`에 기록됩니다.
기록된 usage는 `apps/server`의 `/usage`, `/usage/summary`에서 조회할 수 있고,
`apps/dashboard`의 최소 usage 화면에서 확인할 수 있습니다.
외부 `POST /v1/chat/completions` non-stream 요청도 같은 router path를 거치며 usage record를 남깁니다.
`stream: true` 요청도 SSE로 응답하며, stream 시작 전 실패는 다음 route 후보로 fallback합니다.
외부 server는 기본적으로 `coding-agent`의 `ModelRegistry`와 `AuthStorage`를 사용해 `models.json`, `auth.json`, 환경변수 기반 인증을 공유합니다.
provider connection/settings store와 account selection helper는 1차 구현됐고,
`ModelRegistry.getApiKeyAndHeaders()`가 선택된 provider connection의 `apiKey` 또는 `accessToken`을 사용할 수 있게 연결했습니다.
또한 기존 `auth.json`의 저장된 API key/OAuth 인증을 `provider-connections.json`의 `source=auth.json` connection으로 동기화합니다.
`auth.json` credential이 바뀌면 source connection을 갱신하고, credential이 삭제되면 source connection을 비활성화하며 민감한 token/key 값을 제거합니다.
실패한 provider connection에는 9router의 fallback/cooldown 규칙에 따라 `modelLock_${model}`을 저장하고, 같은 모델 요청에서 잠긴 connection을 제외합니다.
성공한 요청은 해당 connection의 현재 모델 잠금과 만료된 잠금을 정리합니다.
이후 9router 원본의 `resetsAtMs` 흐름처럼 provider가 알려준 정확한 reset 시간을 cooldown에 반영합니다.
예를 들어 Codex `usage_limit_reached.resets_at`, `resets_in_seconds`, `Retry-After`, Antigravity류 `reset after 1h30m` 메시지는 exponential backoff보다 우선하며, 9router처럼 최대 30분으로 cap합니다.
현재 활성화된 `modelLock_${model}` 상태는 `GET /models/availability`와 dashboard의 Model cooldown 표에서 확인할 수 있습니다.
이 availability API는 provider quota detail API를 호출하지 않고, 실제 routing exclusion에 쓰이는 provider connection store의 잠금 상태만 읽습니다.
또한 9router 원본의 `POST /api/models/availability` 흐름처럼 `POST /models/availability`에 `{ "action": "clearCooldown", "provider": "...", "model": "..." }`를 보내면 해당 provider/model의 `modelLock_${model}`을 수동 해제합니다.
dashboard의 Model cooldown 표에도 같은 요청을 보내는 해제 버튼을 추가했습니다.
9router 원본의 provider별 usage/quota 조회 흐름을 기준으로 `GET /quota`, `GET /quota/:connectionId` 1차 API를 추가했습니다.
dashboard에는 provider connection별 quota 조회 가능 여부를 표시합니다.
또한 사용자가 선택한 connection에 대해서만 `/quota/:connectionId`를 호출하는 quota 상세 조회 화면을 추가했습니다.
이후 server의 외부 `/v1/chat/completions` 경로에서는 provider connection 선택 직전에 9router quota fetcher를 사용해 오래된 quota snapshot을 갱신하고,
`providerSpecificData.pieLabQuotaSelection`의 `score`, `remainingPercentage`, `status`를 account selection에 반영합니다.
기본 정책은 `quotaStrategy: "prefer-remaining"`, `quotaRefreshBeforeSelection: true`, `quotaRefreshTtlMs: 60000`입니다.
quota snapshot이 `depleted`이면 해당 connection은 선택에서 제외하고, fresh snapshot이 있는 connection끼리는 잔여 quota가 높은 쪽을 우선합니다.
이후 9router 원본 fetcher 기준으로 `gemini-cli`, `antigravity`, `kiro` quota 조회도 추가했습니다.
OAuth connection은 quota 상세 조회 전에 9router 원본 방식처럼 token 만료 여부를 확인하고, 필요하면 refresh한 뒤 provider connection store에 저장합니다.
또한 quota API가 인증 만료 메시지를 받으면 한 번 force refresh 후 재시도합니다.
이후 9router 원본의 `proxyAwareFetch` 흐름을 기준으로 quota fetch와 token refresh에 connection별 proxy, Vercel relay, 환경변수 proxy, MITM DNS bypass를 연결했습니다.
이후 9router 원본의 `resolveConnectionProxyConfig()` 흐름을 기준으로 `providerSpecificData.proxyPoolId`를 읽어 proxy pool을 해석합니다.
proxy pool은 `provider-connections.json`의 `proxyPools`에 저장하며, Vercel relay pool과 표준 HTTP proxy pool을 quota 상세 조회와 OAuth refresh에 적용합니다.
이후 proxy pool 생성/수정/삭제 API, provider connection에 proxy pool을 지정하는 API, dashboard의 proxy pool 관리/지정 UI도 1차 구현했습니다.
Browser redirect 기반 OAuth login flow는 Claude/Codex/Gemini CLI 기준 1차 구현했습니다.
auth.json source connection의 생성/변경/삭제 동기화는 `ModelRegistry` 기본 경로에 반영했습니다.
이후 9router 원본의 proxy pool test endpoint를 기준으로 `POST /proxy-pools/:proxyPoolId/test`와 dashboard 테스트 버튼도 추가했습니다.

초기 구현 목표는 다음과 같습니다.

```ts
const route = await router.resolve({
  requestedModel: "auto:coding",
  context,
  tools,
});
```

예상 결과:

```ts
{
  requestedModel: "auto:coding",
  routingMode: "router",
  resolvedProvider: "anthropic",
  resolvedModel: "claude-sonnet-4.5",
  connectionId: "anthropic_account_1"
}
```

이후 `pi`는 `resolvedModel`을 기존 provider engine으로 호출합니다.

## 14. 현재 구현된 내부 라우팅 흐름

현재 첫 구현은 내부 `coding-agent` 요청에 router를 끼우는 얕은 연결입니다.

```txt
coding-agent Agent.streamFn
  -> packages/router resolvePiModelRoutePlan()
  -> route plan 순서대로 후보 선택
  -> modelRegistry.getApiKeyAndHeaders(candidateModel)
  -> pi streamSimple(candidateModel, ...)
  -> packages/storage UsageStore에 attempt record 저장
  -> stream 시작 전 실패 시 다음 candidateModel 시도
```

이 방식의 의도는 `pi`의 provider engine, streaming, abort/cancel, tool call 흐름을 그대로 유지하면서 모델 선택만 router 앞으로 이동하는 것입니다.

현재 가능한 선택 예:

```txt
openai/gpt-5.4             # 기본 fallback mode
fixed:openai/gpt-5.4       # model 변경 금지
auto:coding                # router가 coding intent 기준으로 선택
cheap:coding               # 비용 제약을 우선 반영
fast:chat                  # latency 제약을 우선 반영
combo:coding               # route plan에서 여러 후보로 확장
```

`resolvePiModelRoute()`는 현재 route plan의 첫 번째 후보를 반환하는 호환 API입니다.
fallback/ combo 전체 후보가 필요한 실행부는 `resolvePiModelRoutePlan()`을 사용합니다.

중요한 경계:

```txt
stream event가 아직 사용자에게 전달되지 않은 실패
  -> 다음 route 후보로 fallback 가능

stream event가 이미 사용자에게 전달된 뒤의 실패
  -> transcript 일관성을 위해 현재 error를 그대로 전파
```

현재 조회 가능한 usage API:

```txt
GET /usage
GET /v1/usage
GET /usage/summary
GET /v1/usage/summary
```

현재 구현된 OpenAI-compatible API:

```txt
GET  /v1/models
GET  /models
POST /v1/chat/completions  # non-stream + stream:true 1차 지원
POST /v1/embeddings
POST /v1/search
POST /v1/web/fetch
POST /v1/audio/speech
POST /v1/audio/transcriptions
POST /v1/images/generations
```

현재 구현된 provider connection/account selection API:

```txt
GET    /provider-connections
POST   /provider-connections
GET    /provider-connections/:connectionId
PUT    /provider-connections/:connectionId
DELETE /provider-connections/:connectionId
GET    /account-selection
GET    /v1/account-selection
GET    /routing-policy
PUT    /routing-policy
POST   /routing-policy/combos
DELETE /routing-policy/combos/:comboName
POST   /routing-policy/aliases
DELETE /routing-policy/aliases/:aliasName
POST   /routing-policy/intents
DELETE /routing-policy/intents/:intentName
POST   /routing-policy/preview
```

현재 구현된 provider 상태 API:

```txt
GET /providers
GET /v1/providers
```

현재 구현된 model availability API:

```txt
GET /models/availability
GET /v1/models/availability
POST /models/availability
POST /v1/models/availability
```

현재 구현된 provider quota API:

```txt
GET /quota
GET /v1/quota
GET /quota/:connectionId
GET /v1/quota/:connectionId
```

아직 남은 구현:

```txt
- pie-chat bridge 장시간 실사용 검증
- chat-origin usage/cost dashboard 구분 고도화
- dashboard-next의 기존 dashboard 기능 완전 이관
- 설치와 실행 흐름 안정화
```

`pie-chat`은 이름을 `pie-chat`으로 사용하되, 실제 소스 출처는 기존 fork인 `https://github.com/jikime/pi-chat`입니다. 구현 방향은 기존 `pi-chat`의 bridge 흐름을 최대한 유지하고, LLM 직접 호출 부분만 `pie-lab agent runtime -> router -> provider engine` 경로로 바꾸는 것입니다.

현재는 `apps/chat`에 Next.js 웹 채팅과 Telegram/Discord bridge extension을 이식한 상태입니다. `pie -e apps/chat`로 `/chat-config`, `/chat-connect`, `/chat-spawn-all` 같은 기존 bridge 흐름을 사용할 수 있고, worker 실행 명령과 저장 경로는 `pie`와 `~/.pie/agent/chat` 기준으로 정리했습니다. 따라서 남은 일은 bridge 코드를 처음부터 다시 통합하는 것이 아니라, 실제 Telegram/Discord 환경에서 장시간 송수신을 검증하고, chat-origin usage/cost와 dashboard 관찰성을 더 분명하게 만드는 것입니다.

## 15. 9router 원본 기준 라우팅 원칙

`pie-lab`의 router 판단 기준은 임의 점수 계산으로 확장하지 않습니다.

`9router` 원본에서 확인한 실제 라우팅/운영 기준은 다음입니다.

```txt
1. 명시 model 요청
   - cc/claude-opus-4-7
   - glm/glm-5.1
   - kr/claude-sonnet-4.5

2. named combo
   - premium-coding
   - budget-combo
   - free-combo

3. combo model 순서
   - 사용자가 dashboard/config에서 정한 순서대로 시도
   - 예: subscription -> cheap -> free

4. combo strategy
   - fallback: 항상 첫 후보부터 순서대로 시도
   - round-robin: combo 안의 후보를 회전
   - sticky round-robin: N번은 같은 후보를 유지한 뒤 다음 후보로 이동

5. account selection
   - fill-first: provider connection priority 순서
   - round-robin: 계정별 lastUsedAt/consecutiveUseCount 기준 회전
   - quota-aware: provider quota snapshot의 잔여량이 높은 connection 우선

6. cooldown / fallback
   - rate limit, quota exceeded, too many requests, capacity, overloaded
   - 401/402/403/404
   - provider-specific reset time
   - modelLock_${model} 단위로 특정 account/model을 임시 제외

7. quota/usage
   - provider별 quota fetcher로 잔여량과 reset time 확인
   - pie-lab에서는 이 quota snapshot을 account selection에도 반영
   - 실제 routing attempt와 usage record를 dashboard에 표시

8. RTK token saver
   - 모델 선택 기준이 아니라 요청 전 tool_result 압축 단계
```

따라서 `auto:coding`, `cheap:coding`, `fast:chat` 같은 현재 `pie-lab` alias는 최종 정책의 핵심이 아닙니다.
운영 기준은 9router처럼 사용자가 만든 combo와 provider/account 상태를 기반으로 잡습니다.

이번 단계에서 `packages/router`와 `packages/storage`에는 9router 원본의 다음 기능을 반영했습니다.

```txt
- named combo 해석
- combo fallback 순서 유지
- combo round-robin
- combo sticky round-robin
- rate limit/quota/error cooldown 규칙
- provider reset time 기반 cooldown
- account/model lock helper
- model availability/cooldown API와 dashboard
- 9router clearCooldown action 기반 model lock 수동 해제
- unavailable account filter
- quota-aware account selection
- provider connection/settings store
- proxy pool store
- fill-first / account round-robin / sticky account round-robin selection helper
- quota API의 proxy pool 해석
```

이후 `checkFallbackError()`를 실제 실행 경로에도 연결했습니다.

현재 연결된 곳:

```txt
apps/server POST /v1/chat/completions non-stream
  -> route attempt 실패
  -> 9router checkFallbackError()
  -> fallback 여부 결정
  -> usage record에 errorCode 저장

apps/server POST /v1/chat/completions stream:true
  -> SSE chunk 전 실패
  -> 9router checkFallbackError()
  -> fallback 여부 결정

coding-agent 내부 streamFn
  -> stream 시작 전 실패
  -> 9router checkFallbackError()
  -> 다음 route 후보 시도 여부 결정
```

provider connection 선택 연결:

```txt
ModelRegistry.getApiKeyAndHeaders(model)
  -> provider-connections.json 조회
  -> auth.json source connection 동기화
  -> 필요하면 9router quota fetcher로 quota snapshot 갱신
  -> selectProviderConnection()
  -> 선택된 connection의 apiKey/accessToken 사용
  -> connectionId를 usage record에 전달
```

auth.json source connection 동기화:

```txt
auth.json에 credential 있음
  -> providerSpecificData.source = "auth.json" connection 생성/갱신
  -> credential 변경 시 stale quota snapshot과 modelLock/error 상태 정리

auth.json에서 credential 삭제
  -> source = "auth.json" connection만 비활성화
  -> apiKey/accessToken/refreshToken 제거
  -> manual provider connection은 유지
```

quota refresh/preparer 연결:

```txt
@pie-lab/shared
  -> provider quota fetcher
  -> OAuth refresh
  -> proxy pool / Vercel relay / env proxy 처리
  -> providerSpecificData.pieLabQuotaSelection snapshot 저장

apps/server
  -> /quota API와 /v1/chat/completions에서 shared 구현 사용

packages/coding-agent
  -> createAgentSession()
  -> createAgentSessionServices()
  -> 내부 직접 실행에서도 shared quota-aware preparer 사용
```

따라서 pie-lab의 현재 기준은 “server API에서만 9router quota를 쓰는 구조”가 아니라, 기본 ModelRegistry를 쓰는 실행 경로에서 같은 quota-aware account selection을 공유하는 구조입니다.

provider connection 실패 상태 연결:

```txt
provider 호출 실패
  -> 9router checkFallbackError()
  -> buildModelLockUpdate(model, cooldownMs)
  -> provider-connections.json의 modelLock_${model} 저장
  -> 다음 요청에서 selectProviderConnection()이 잠긴 connection 제외
  -> /models/availability와 dashboard Model cooldown 표에서 현재 lock 확인
  -> 필요하면 9router clearCooldown action으로 해당 provider/model lock 수동 해제

provider 호출 성공
  -> 현재 modelLock_${model}과 만료된 lock 정리
  -> 활성 lock이 없으면 testStatus/error/backoff 상태 초기화
```

아직 남은 연결:

```txt
- 설치와 실행 흐름 안정화
```

## Claude Agent SDK provider 결정

Claude Code의 로컬 로그인/구독 흐름을 router 후보로 쓰기 위해 `claude-code-adk` provider를 추가했습니다.

이 provider는 기존 `anthropic` provider를 대체하지 않습니다. 기존 `anthropic` provider는 Anthropic Messages API 또는 OAuth 기반 직접 호출 경로이고, `claude-code-adk`는 `@anthropic-ai/claude-agent-sdk`의 `query()`를 사용하는 Claude Code 로컬 실행 경로입니다.

현재 등록 모델:

```txt
claude-code-adk/claude-sonnet-4-6
claude-code-adk/claude-opus-4-7
claude-code-adk/claude-haiku-4-5
```

기본 구조:

```txt
pie agent/session
  -> router resolve
  -> claude-code-adk model
  -> @pie-lab/ai provider registry
  -> Claude Agent SDK query()
  -> 로컬 Claude Code 실행 계층
```

`ModelRegistry`는 `claude-code-adk`를 local provider로 취급합니다. 그래서 API key가 없어도 사용 가능한 provider로 표시하고, 빈 policy 기준 `auto:coding`은 `claude-code-adk/claude-sonnet-4-6`으로 resolve될 수 있습니다.

선택 시에는 provider를 포함한 `claude-code-adk/claude-sonnet-4-6` 형태를 명시해야 합니다. `anthropic/claude-opus-4-7` 또는 `api: anthropic-messages`로 기록되면 기존 Anthropic provider를 사용한 것이며, Claude Code ADK 경로가 아닙니다.

주의할 점:

- 이 경로는 순수 LLM completion API가 아니라 Claude Code agent 실행 계층입니다.
- Claude Code가 자체 tool을 사용할 수 있고 repository 파일을 수정할 수 있습니다.
- 공개 third-party proxy처럼 claude.ai 로그인/구독을 대신 제공하는 방향으로 확장하지 않습니다.
- 기존 Anthropic API/OAuth 경로는 fallback 또는 직접 모델 선택용으로 계속 유지합니다.
- branch summary/compaction 같은 보조 호출도 local provider에서는 API key 없이 실행될 수 있게 맞춥니다.
- SDK는 직접 `claude -p` 명령을 조립하는 wrapper가 아니라, 로컬 Claude Code subprocess와 `stream-json`으로 통신하는 headless 실행 경로입니다.
- SDK 버전 다운그레이드는 해결책으로 채택하지 않습니다. 현재 기준은 `@anthropic-ai/claude-agent-sdk@0.3.150`입니다.
- Claude Code는 자체 agent system prompt를 갖고 있으므로, `pi`의 기존 LLM system prompt는 기본으로 append하지 않습니다.
- 단일 사용자 요청은 transcript wrapper 없이 그대로 전달하고, 이전 대화가 있을 때만 이전 transcript를 참고용 context로 붙입니다.
