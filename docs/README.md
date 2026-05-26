# pie-lab 문서

`pie-lab`은 `pi`, `9router`, `pie-chat`을 하나의 통합 프로젝트로 재구성하기 위한 작업 이름입니다.

목표는 단순히 여러 저장소의 코드를 한곳에 모으는 것이 아닙니다. `pie-lab`이라는 별도 git repository를 만들고, 그 안의 초기 코드베이스로 `pi`의 소스를 그대로 사용합니다. 그 위에 `9router`의 라우터/대시보드/CLI/사용량 관리와 `pie-chat`의 Discord/Telegram chat bridge 경험을 통합해서 **개인화 가능한 Agentic Development Kit**로 발전시키는 것입니다.

## 문서 구성

- [비전](./vision.md): `pie-lab`이 무엇을 만들고, 무엇을 만들지 않을지 정의합니다.
- [통합 아키텍처](./architecture.md): `pi`, `9router`, `pie-chat`을 어떤 역할로 합칠지 설명합니다.
- [마이그레이션 계획](./migration-plan.md): 기존 프로젝트에서 어떤 코드를 가져오고 어떻게 재배치할지 정리합니다.
- [로드맵](./roadmap.md): MVP부터 이후 확장까지의 단계별 개발 계획입니다.
- [사용량과 비용 측정](./usage-accounting.md): routing 이후 실제 사용량과 비용을 어디서 어떻게 기록할지 정리합니다.
- [Learning Loop](./learning-loop.md): persistent memory, 자동 skill 생성, Honcho user modeling, curator 운영 방식을 정리합니다.
- [Claude Agent SDK provider](./claude-agent-sdk-provider.md): Claude Code 로컬 구독/로그인 흐름을 router 후보로 쓰는 방법을 정리합니다.
- [채팅 사용법](./chat-usage.md): 웹 채팅과 Telegram/Discord bridge 설정, 연결, 문제 해결 방법을 정리합니다.
- [Pie Gateway](./gateway.md): TUI 없이 장시간 Telegram/Discord 메시지와 cron scheduled automation을 처리하는 gateway 운영 방식을 정리합니다.
- [pie-chat E2E 검증 체크리스트](./chat-e2e-checklist.md): 실제 Telegram/Discord 채널에서 bridge를 검증하는 기준을 정리합니다.
- [배포](./deployment.md): GitHub Pages `install.sh`와 npm package 배포 흐름을 정리합니다.
- [npm 릴리스 플레이북](./npm-release-playbook.md): 실제 npm 배포 명령, 검증 순서, 2FA/token 주의사항, `web-ui` 제외 기준을 정리합니다.
- [dashboard 이관 범위](./dashboard-migration.md): 기존 Vite dashboard 기능을 Next.js dashboard로 옮길 때의 기준과 우선순위를 정리합니다.
- [소스 출처](./origins.md): `pi`, `9router`, `pie-chat` fork와 import 기준 commit을 기록합니다.
- [현재 결정 사항](./current-decisions.md): 지금까지 결정한 통합 방향과 현재 구조를 요약합니다.
- [구현 이력](./implementation-log.md): 실제 코드에 반영된 작업과 검증 결과를 기록합니다.

## 한 줄 정의

`pie-lab`은 `pi`의 전체 기능을 그대로 기반으로 삼고, 여러 AI provider, 모델 라우팅, agent runtime, tool calling, 비용 관리, 대시보드, chat bridge를 하나로 묶은 로컬 우선 Agentic Development Kit입니다.

## 현재 통합 상태

현재 `pie-lab`은 `pi` 기반 CLI/TUI를 유지하면서 `9router`의 핵심 라우팅, fallback, provider connection, quota, cooldown, usage/cost 기록을 `pie` 내부 호출과 local `/v1` API에 연결한 상태입니다. 또한 최신 `Claude Agent SDK`를 `claude-code-adk` 로컬 provider로 추가해, `auto:coding` 같은 router 요청이 Claude Code 로컬 로그인/구독 흐름을 후보로 사용할 수 있게 했습니다.

`apps/server`는 OpenAI-compatible chat completions, streaming SSE, embeddings, web search/fetch, TTS/STT, image generation endpoint를 제공합니다. `apps/dashboard`는 Next.js 16, Tailwind CSS 4, shadcn/ui 기반의 기본 dashboard이며 usage detail, provider setup, OAuth redirect login, quota detail, model availability, routing policy form, budget form, proxy 관리, media endpoint test form, Learning Loop 운영 화면까지 포함합니다.

`apps/chat`은 `pie-chat` 영역으로, Next.js 웹 채팅과 Telegram/Discord bridge extension을 함께 담고 있습니다. 웹 채팅은 `pie-chat:web`, bridge worker는 `pie-chat:telegram` 또는 `pie-chat:discord` origin으로 usage/cost를 남깁니다. 프로젝트 설정에서 `apps/chat`을 local package로 등록해 두었기 때문에 저장소 루트에서 `pie`를 실행하면 `/chat-config`, `/chat-connect` 같은 bridge 명령이 로드됩니다.

장시간 운영 경로는 `pie gateway`로 분리했습니다. Gateway는 TUI 세션 없이 Telegram/Discord 메시지를 받고, 같은 프로세스에서 scheduler tick을 실행해 cron 결과를 원래 채팅방으로 전달할 수 있습니다.

다음 큰 작업은 다음 순서로 진행합니다.

```txt
1. 설치와 실행 흐름 안정화
2. 실제 Telegram/Discord 계정 기준 end-to-end 송수신 검증
3. dashboard 사용성 문구와 필터 개선
4. root build/dev 회귀 확인과 배포 흐름 정리
```

## 기본 방향

핵심 설계 원칙은 다음과 같습니다.

> `pie-lab`은 별도 git repository로 만들고, 초기 코드베이스는 `pi` 소스를 그대로 사용하며, 여기에 `9router`의 라우팅/운영 기능과 `pie-chat`의 채팅 브리지 기능을 통합해, 앞으로 개인화 가능한 나만의 Agentic Development Kit로 발전시키는 프로젝트입니다.

구현은 빈 저장소에서 새로 시작하지 않습니다. `pie-lab` repository를 만든 뒤, 그 안에 `pi` 소스를 초기 코드베이스로 가져옵니다. 이후 같은 repository 안에서 `9router`와 `pie-chat`을 통합하고, 필요한 부분을 역할별 패키지와 앱으로 점진적으로 정리합니다.

`pi`는 일부 코드만 떼어오는 것이 아니라 전체 기능과 기존 사용 흐름을 그대로 기반으로 삼습니다.

`9router`는 라우터, 대시보드, CLI, provider 계정 관리, quota/fallback 관리 기능으로 흡수합니다.

`pie-chat`은 Discord/Telegram 같은 외부 채팅 채널과 agent session을 연결하는 chat bridge로 흡수합니다.

`pie-lab`은 세 프로젝트 위에 agent 개발 경험을 추가합니다.

```txt
pie-lab
├─ pi git source 기반
│  ├─ core/runtime
│  ├─ provider engine
│  ├─ context/session
│  ├─ tools/extensions
│  └─ TUI/기존 사용 흐름
├─ 9router 기반 router/dashboard/cli
├─ pie-chat 기반 chat bridge
└─ 개인화 가능한 ADK layer
   ├─ custom agents
   ├─ custom routing policy
   ├─ custom workflow
   └─ OpenAI-compatible API + ADK-native API
```

## 협업 원칙

초기에는 기능을 많이 늘리기보다, 기존 기능의 책임을 분명히 나누는 것이 중요합니다.

- `pie-lab`은 별도 git repository로 둡니다.
- 초기 코드베이스는 `pi` 소스를 그대로 사용합니다.
- `pi`의 기존 기능과 사용성을 가능한 한 보존합니다.
- 모델 호출 표준은 `pi` 기준으로 통일합니다.
- 라우팅, fallback, quota, 사용량 기록은 `9router` 기준으로 통합합니다.
- dashboard와 CLI는 `9router`를 기반으로 재구성합니다.
- Discord/Telegram 같은 외부 채팅 연결은 `pie-chat`을 기반으로 재구성합니다.
- agent와 tool 정의 방식은 `pi`의 기존 흐름을 존중하면서 `pie-lab`에서 확장합니다.
- chat bridge도 직접 LLM을 호출하지 않고 `pie-lab` router를 거치게 합니다.
- 개인화와 커스터마이징을 핵심 목표로 둡니다.
- 같은 기능을 두 군데에서 유지하지 않습니다.
