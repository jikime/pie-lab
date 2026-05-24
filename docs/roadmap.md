# 로드맵

## v0.1: 통합 MVP

목표는 `pi`의 기존 기능을 가능한 한 보존한 상태에서 `9router`가 하나의 프로젝트 안에서 실제로 함께 동작하는 모습을 만드는 것입니다. `pie-chat`은 이 단계에서 통합 위치만 확정하고, 실제 기능 통합은 뒤 단계로 둡니다.

필수 기능:

- `pi` git source 기반 baseline
- 기존 `pi` packages/scripts/tests 보존
- `packages/router`
- `packages/storage`
- `apps/server`
- `apps/dashboard`
- 기존 `pi` CLI/TUI와 9router CLI 기능 연결
- `GET /v1/models`
- `POST /v1/chat/completions`
- provider 등록
- usage log 저장
- usage log 조회 API
- 최소 1단계 fallback
- 기존 `pi` 핵심 workflow 보존
- 내부 실행 경로: `pi runtime -> router -> pi provider engine`
- 외부 실행 경로: `/v1 HTTP -> router -> pi provider engine`

성공 기준:

```bash
pie start
```

명령으로 local server와 dashboard가 뜨고, OpenAI-compatible client가 `http://localhost:20128/v1`에 연결할 수 있어야 합니다.

추가 성공 기준:

- `auto:coding` 요청이 `packages/router`에서 실제 provider/model로 resolve됩니다.
- `combo:coding`과 structured fallback 요청이 route plan으로 계산됩니다.
- 9router-style named combo, 예를 들어 `premium-coding`, `budget-combo`가 route plan으로 계산됩니다.
- combo strategy로 `fallback`, `round-robin`, sticky round-robin을 처리합니다.
- rate-limit/quota 오류를 9router 원본 cooldown 규칙으로 분류합니다.
- provider connection/settings store가 있고, 계정 선택 helper가 `fill-first`, `round-robin`, sticky round-robin을 계산합니다.
- 내부 `coding-agent` stream 경로에서 stream 시작 전 실패는 다음 route 후보로 fallback됩니다.
- `Claude Agent SDK` 기반 `claude-code-adk` provider가 router 후보로 등록됩니다.
- fallback attempt의 success/error/aborted 결과가 usage record로 저장됩니다.
- 저장된 usage record를 `/usage`와 `/usage/summary`에서 조회할 수 있습니다.
- dashboard에서 usage summary와 최근 record를 확인할 수 있습니다.
- 외부 `POST /v1/chat/completions` non-stream 요청이 router를 거쳐 실행됩니다.
- 외부 `POST /v1/chat/completions` streaming/SSE 요청이 router를 거쳐 실행됩니다.
- 외부 `/v1` 요청이 `coding-agent`의 `models.json`, `auth.json` 인증 설정을 공유합니다.
- dashboard에서 provider/auth 설정 여부를 확인할 수 있습니다.
- 내부 `pi` 실행과 외부 `/v1` 요청이 같은 router를 사용합니다.
- resolved model 기준으로 usage/cost가 저장됩니다.
- dashboard에서 provider connection을 생성/활성화/삭제할 수 있습니다.
- dashboard에서 왜 특정 account가 선택됐는지 확인할 수 있습니다.
- RTK token saver 절감량이 usage record와 dashboard에 표시됩니다.
- compaction 같은 보조 LLM 호출도 router resolve를 거칩니다.
- embedding, web search/fetch, TTS/STT, image generation endpoint가 server에 연결됩니다.
- dashboard에서 fallback chain/combo policy를 생성, 삭제, preview할 수 있습니다.
- dashboard에서 alias/intent mapping을 생성, 삭제, preview할 수 있습니다.

## v0.2: 기존 agent 사용 경험 정리

목표는 `pi`의 기존 `coding-agent`, skill, extension, prompt-template, `@pie-lab/agent-core` 흐름을 `pie-lab` 기준으로 정리하는 것입니다.

필수 기능:

- 기존 `pie` CLI 사용법 정리
- `pie -p` 기반 non-interactive 실행 정리
- skill과 extension 사용법 정리
- router 경유 모델 호출 검증
- usage/cost 기록 검증

현재 기준:

- 새 agent runner를 추가하지 않고, 기존 `pie` CLI와 coding-agent 기능을 기준으로 정리합니다.

성공 기준:

```bash
pie -p "README.md를 요약해줘" @README.md
```

명령이 기존 coding-agent 경로로 실행되고, router와 usage/cost 기록을 거쳐야 합니다.

## v0.3: Router 고도화

목표는 `9router`의 장점을 통합 구조 안에서 제대로 살리는 것입니다.

1차 반영 완료:

- usage/cost dashboard 연결
- dashboard provider setup의 manual API key/token 등록
- provider별 quota 정책
- 계정 round-robin과 sticky round-robin
- modelLock 기반 account/model cooldown
- provider connection store와 실제 pi 인증 저장소 기본 동기화
- model alias
- retry/fallback policy
- streaming fallback 안정화
- RTK token saver 1차 통합
- embedding, web search/fetch, TTS/STT, image generation endpoint
- fallback chain dashboard 편집
- alias/intent mapping dashboard 편집
- OAuth token import wizard
- quota 상세 dashboard 고도화 1차
- budget limit dashboard 정책 편집
- budget limit 실제 enforcement
- browser redirect 기반 provider별 OAuth login wizard
- provider health check 화면 고도화
- provider health check deep probe
- media endpoint alias와 provider 고급 옵션 1차
- media endpoint별 provider coverage 확대 1차
- request detail viewer와 fallback timeline
- request detail raw event trace
- routing policy import/export, combo reorder, model suggestion
- Claude Code 로컬 로그인/구독을 사용하는 `claude-code-adk` provider
- Claude Agent SDK 최신 버전 기준 headless stream-json 실행과 Claude Code 자체 prompt 우선 처리

성공 기준:

- provider 하나가 실패해도 fallback provider로 이어집니다.
- dashboard에서 fallback 결과와 비용을 확인할 수 있습니다.
- CLI 도구가 장시간 사용 중에도 안정적으로 동작합니다.

## v0.4: Dashboard/CLI 제품화

목표는 개발자들이 매일 사용할 수 있는 도구로 다듬는 것입니다.

현재 방향:

- 대시보드 제품화는 `apps/dashboard`에서 진행합니다.
- 기술 스택은 Next.js 16, Tailwind CSS 4, shadcn/ui로 정합니다.
- 기존 Vite dashboard는 `apps/dashboard_old`에 비교 기준으로 보관합니다.

필수 기능:

- dashboard navigation 정리
- provider setup wizard
- model selector
- request detail viewer
- agent run viewer
- CLI provider setup
- CLI model selection
- local config import/export

현재 상태:

- `apps/dashboard_old`에는 usage, provider, quota, budget, proxy, routing policy, request detail, raw trace 같은 9router 운영 화면의 Vite 기준 구현이 보관되어 있습니다.
- `apps/dashboard`는 Next.js 16, Tailwind CSS 4, shadcn/ui, Pretendard, SEO 기반 shell과 주요 메뉴 구조를 갖춘 상태입니다.
- usage detail sheet, fallback timeline, raw trace, origin/endpoint별 usage 집계, provider connection 생성/활성화/삭제, OAuth redirect login, provider별 setup guide, quota detail, model availability cooldown clear, routing combo/alias/intent form, budget form, proxy update/delete/binding, media endpoint test form이 이관되었습니다.
- `apps/dashboard`는 기본 제품형 dashboard이며 root build 대상입니다.

성공 기준:

- 신규 사용자가 문서만 보고 provider를 등록하고 local endpoint에 연결할 수 있습니다.
- 사용량과 비용을 dashboard에서 쉽게 확인할 수 있습니다.

## v0.5: Chat Bridge 통합

목표는 `pie-chat`의 Discord/Telegram bridge 경험을 `pie-lab` agent runtime과 router 위에 올리는 것입니다.

필수 기능:

- `apps/chat`
- `packages/chat`
- Discord 또는 Telegram 중 1개 채널 우선 지원
- chat message를 agent input으로 변환
- agent response를 chat reply로 전송
- 최소 remote command: `status`, `new`, `stop`
- chat-origin usage/cost 기록

현재 상태:

- `apps/chat`은 Next.js 16 기반 웹 채팅 앱과 Telegram/Discord bridge extension을 함께 담습니다.
- 웹 채팅은 `apps/server`의 `/v1/chat/completions` streaming endpoint를 호출하며 기본 모델은 `auto:chat`입니다.
- 기존 `pi-chat` bridge 흐름을 `apps/chat/extension` 아래로 이식했고, 프로젝트 설정이 `apps/chat`을 local package로 로드하므로 저장소 루트의 일반 `pie` 세션에서 `/chat-config`, `/chat-connect`, `/chat-spawn-all`, `/chat-workers` 등을 사용할 수 있습니다.
- Telegram/Discord 채널별 workspace, memory, skills, attachment, tmux worker 구조는 `~/.pie/agent/chat` 기준으로 정리했습니다.

남은 일:

- 실제 Telegram/Discord 계정으로 장시간 end-to-end 송수신을 검증합니다.
- 웹 채팅과 Telegram/Discord bridge 요청은 `clientOrigin`으로 usage/cost가 구분됩니다.

성공 기준:

- Discord 또는 Telegram에서 메시지를 보내면 `pie-lab` agent가 실행됩니다.
- 해당 요청은 `pie-lab` router를 거쳐 실제 model로 라우팅됩니다.
- dashboard에서 requested model, resolved model, provider, cost를 확인할 수 있습니다.

## 우선순위 원칙

개발 순서를 정할 때는 다음 기준을 사용합니다.

1. 기존 `pi`와 `9router`의 중복을 줄이는가?
2. 실제 사용자가 바로 체감하는가?
3. OpenAI-compatible endpoint 안정성을 높이는가?
4. agent 개발 경험을 단순하게 만드는가?
5. dashboard와 CLI에서 확인 가능한가?
6. chat bridge 요청도 router/usage 원칙을 지키는가?

이 기준에 맞지 않는 기능은 나중으로 미룹니다.
