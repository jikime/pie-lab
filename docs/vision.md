# pie-lab 비전

## 목적

`pie-lab`의 목적은 별도 git repository 안에 `pi` 소스를 초기 코드베이스로 가져오고, 그 위에 AI agent를 만들고, 실행하고, 관리하는 데 필요한 기반을 통합 프로젝트로 제공하는 것입니다.

기존 `pi`는 여러 LLM provider를 일관된 방식으로 호출하고, agent/runtime/tool/context/session 흐름을 제공하는 기반 프로젝트입니다. 반면 `9router`는 실제 사용자 환경에서 provider 계정, 라우팅, fallback, 사용량, 대시보드, CLI 연결을 다루는 운영 도구에 가깝습니다. `pie-chat`은 Discord와 Telegram 같은 외부 채팅 채널을 agent session과 연결하는 bridge 성격이 강합니다.

`pie-lab`은 이 프로젝트들을 통합해서 다음 문제를 해결합니다.

- 여러 provider와 모델을 하나의 방식으로 호출하고 싶다.
- 실패, quota 초과, 비용 제한 상황에서 자동으로 fallback하고 싶다.
- OpenAI-compatible endpoint로 Codex, Claude Code, Cursor, Cline 같은 도구를 연결하고 싶다.
- agent, tool, context, memory를 표준 방식으로 정의하고 실행하고 싶다.
- provider 상태, 비용, 사용량, 요청 로그를 dashboard에서 보고 싶다.
- 개인 또는 팀이 반복 업무용 agent를 쉽게 만들고 공유하고 싶다.
- Discord나 Telegram 같은 채팅 채널에서 agent를 실행하고 관리하고 싶다.

## 제품 정의

`pie-lab`은 **로컬 우선 Agentic Development Kit**입니다.

조금 더 풀어 쓰면 다음과 같습니다.

> `pi`의 git 소스와 전체 기능을 기반으로 여러 AI 모델과 계정을 하나로 묶고, agent/tool/context를 표준 방식으로 실행하며, 비용과 quota, 외부 chat bridge까지 관리해주는 로컬 우선 Agentic Development Kit.

설계 관점에서는 다음 원칙을 따릅니다.

> `pie-lab`은 별도 git repository로 만들고, 초기 코드베이스는 `pi` 소스를 그대로 사용하며, 여기에 `9router`의 라우팅/운영 기능과 `pie-chat`의 채팅 브리지 기능을 통합해, 앞으로 개인화 가능한 나만의 Agentic Development Kit로 발전시키는 프로젝트입니다.

즉, git repository는 `pie-lab`로 별도 생성하되, 코드의 출발점은 `pi`의 기존 source입니다. 그 위에 `9router`는 내장 router/운영 layer로, `pie-chat`은 외부 chat bridge layer로 흡수합니다. 이후 필요에 따라 역할별 패키지와 앱으로 점진적으로 정리합니다.

이 프로젝트는 처음부터 완성된 범용 framework를 목표로 하기보다, 실제 사용자가 자신의 workflow, routing policy, agent template, dashboard를 계속 커스터마이징해가는 개인화 가능한 agentic development kit을 목표로 합니다.

## 핵심 사용자

초기 사용자는 다음과 같습니다.

- 여러 AI coding tool을 함께 쓰는 개인 개발자
- API 비용과 provider quota를 관리해야 하는 power user
- 반복 업무를 agent로 만들고 싶은 개발자
- 팀 내부 AI gateway와 agent 실행 환경이 필요한 소규모 팀
- provider별 API 차이를 직접 다루고 싶지 않은 agent 개발자
- Discord/Telegram 같은 채널에서 agent를 운영하고 싶은 사용자

## 핵심 가치

### 1. pi 전체 기능 보존

`pie-lab`은 `pi`에서 필요한 일부 코드만 가져오는 것이 아니라, 별도 `pie-lab` repository 안에서 `pi` 소스와 기존 기능을 그대로 출발점으로 삼습니다.

포함 대상:

- core/runtime
- provider engine
- context/session
- tools/extensions
- TUI와 기존 사용 흐름
- agent 실행과 관련된 기존 구조

이 위에 `9router`와 `pie-chat`을 통합합니다.

### 2. 하나의 provider engine

모델 호출, streaming, tool call, context, usage 계산은 하나의 기준으로 통일합니다.

`pi`의 provider abstraction을 기반으로 삼고, `9router` 안에 흩어진 provider 호출 로직은 점진적으로 정리합니다.

### 3. router 내장

`pie-lab`은 단순 SDK가 아닙니다.

실행 중 다음 상황을 다룰 수 있어야 합니다.

- provider 장애
- rate limit
- quota 소진
- 비용 제한 초과
- 모델 미지원
- 계정별 사용량 분산

이 부분은 `9router`의 경험을 적극적으로 흡수합니다.

### 4. 기존 agent 경험 보존

`pie-lab`은 `pi`의 기존 coding-agent, skill, extension, prompt-template 흐름을 우선 보존합니다.

지금 중요한 것은 새 DSL보다 기존 실행 경로가 router, quota, usage/cost 기록을 안정적으로 통과하는 것입니다.

### 5. 로컬 우선

초기 버전은 로컬 실행을 우선합니다.

- API key와 OAuth token은 로컬에 저장합니다.
- 사용량과 요청 로그도 로컬에서 확인할 수 있어야 합니다.
- dashboard는 로컬 서버로 실행합니다.
- cloud sync나 hosted service는 나중 단계로 둡니다.

### 6. OpenAI-compatible + ADK-native

외부 도구와 연결하기 위해 OpenAI-compatible API는 반드시 유지합니다.

동시에 agent 개발을 위해 ADK-native API도 제공합니다.

```txt
/v1/chat/completions    # OpenAI-compatible
/v1/responses           # OpenAI-compatible
/adk/agents/run         # ADK-native
/adk/tools              # ADK-native
```

### 7. chat bridge

`pie-chat`의 경험은 외부 채팅 채널과 agent runtime을 연결하는 layer로 흡수합니다.

초기 대상은 다음과 같습니다.

- Discord channel
- Telegram DM/group
- chat command
- file attachment
- channel/account memory
- remote status/new/stop 같은 제어 명령

중요한 원칙은 chat bridge가 LLM을 직접 호출하지 않는 것입니다.

```txt
Discord/Telegram
  -> chat bridge
  -> agent runtime
  -> router
  -> provider engine
  -> usage log
```

이렇게 해야 chat에서 발생한 요청도 동일하게 routing, fallback, quota, usage/cost tracking을 적용받습니다.

### 8. 개인화 가능한 ADK

`pie-lab`은 사용자가 자신의 업무 방식에 맞게 계속 커스터마이징하는 것을 중요한 목표로 둡니다.

예시:

- 개인 agent template
- 개인 workflow
- custom routing policy
- custom dashboard view
- 자주 쓰는 tool/skill 묶음
- Discord/Telegram 기반 자동화 흐름

처음부터 모두에게 맞는 범용 framework를 만들기보다, 실제 사용자가 매일 쓰면서 자기 방식으로 확장할 수 있는 ADK를 지향합니다.

## 만들지 않을 것

초기에는 다음을 목표로 삼지 않습니다.

- LangChain 전체를 대체하는 거대한 workflow framework
- 처음부터 cloud SaaS로 운영되는 hosted service
- provider marketplace
- 복잡한 enterprise 권한 체계
- 시각적 workflow builder
- 처음부터 모든 `pie-chat` 기능을 완전히 통합

이 기능들은 나중에 붙일 수 있습니다. 초기에는 통합된 실행 기반과 agent 개발 경험을 단단하게 만드는 것이 더 중요합니다.

## 성공 기준

MVP가 성공했다고 볼 수 있는 기준은 다음과 같습니다.

- `pie start`로 dashboard와 local API server가 실행됩니다.
- dashboard에서 provider를 등록할 수 있습니다.
- Codex, Claude Code, Cursor 같은 도구가 `http://localhost:20128/v1`에 연결됩니다.
- `pi`의 기존 기능과 사용 흐름을 가능한 한 보존합니다.
- 내부 모델 호출은 `pi` 기반 provider engine을 사용합니다.
- 요청 로그, token, 비용, provider 사용량이 기록됩니다.
- 기존 `pie` CLI와 `pie -p` 실행이 router와 usage/cost 기록을 거쳐 안정적으로 동작합니다.
- 실패 또는 quota 소진 시 최소 1단계 fallback이 동작합니다.

`pie-chat` 기반 chat bridge는 MVP 이후 단계에서 통합합니다. MVP에서는 구조상 들어갈 위치와 router 경유 원칙만 확정합니다.
