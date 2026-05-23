# pie-lab 문서

`pie-lab`은 `pi`, `9router`, `pie-chat`을 하나의 통합 프로젝트로 재구성하기 위한 작업 이름입니다.

목표는 단순히 여러 저장소의 코드를 한곳에 모으는 것이 아닙니다. `pie-lab`이라는 별도 git repository를 만들고, 그 안의 초기 코드베이스로 `pi`의 소스를 그대로 사용합니다. 그 위에 `9router`의 라우터/대시보드/CLI/사용량 관리와 `pie-chat`의 Discord/Telegram chat bridge 경험을 통합해서 **개인화 가능한 Agentic Development Kit**로 발전시키는 것입니다.

## 문서 구성

- [비전](./vision.md): `pie-lab`이 무엇을 만들고, 무엇을 만들지 않을지 정의합니다.
- [통합 아키텍처](./architecture.md): `pi`, `9router`, `pie-chat`을 어떤 역할로 합칠지 설명합니다.
- [마이그레이션 계획](./migration-plan.md): 기존 프로젝트에서 어떤 코드를 가져오고 어떻게 재배치할지 정리합니다.
- [로드맵](./roadmap.md): MVP부터 이후 확장까지의 단계별 개발 계획입니다.
- [사용량과 비용 측정](./usage-accounting.md): routing 이후 실제 사용량과 비용을 어디서 어떻게 기록할지 정리합니다.
- [채팅 사용법](./chat-usage.md): 웹 채팅과 Telegram/Discord bridge 설정, 연결, 문제 해결 방법을 정리합니다.
- [소스 출처](./origins.md): `pi`, `9router`, `pie-chat` fork와 import 기준 commit을 기록합니다.
- [현재 결정 사항](./current-decisions.md): 지금까지 결정한 통합 방향과 현재 구조를 요약합니다.
- [구현 이력](./implementation-log.md): 실제 코드에 반영된 작업과 검증 결과를 기록합니다.

## 한 줄 정의

`pie-lab`은 `pi`의 전체 기능을 그대로 기반으로 삼고, 여러 AI provider, 모델 라우팅, agent runtime, tool calling, 비용 관리, 대시보드, chat bridge를 하나로 묶은 로컬 우선 Agentic Development Kit입니다.

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
