# 프로젝트 안내 — pie-lab + open-design-port 하네스

개발 규칙(코드 품질·금지 명령·커밋 스타일)은 `AGENTS.md`를 따른다. 이 파일은 **하네스 길잡이**다.

## open-design-port 하네스
open-design(`/Users/jikime/Dev/Business/promline/open-design`)의 디자인 워크스페이스 기능을, 우리 **pie agent**(`packages/agent`+`coding-agent`) 엔진 기반 **pie-lab 웹 기능**으로 이식하는 기능 이식 공장.

### 자연어 라우팅 (먼저 읽기)
아래 성격의 요청이면 스킬명을 직접 입력하지 않아도 **`open-design-port-orchestrator` 스킬을 먼저 사용**한다.
- "open-design 이 기능 웹으로 만들어줘", "pie agent로 이식해줘", "핵심 루프 MVP 만들어줘", "디자인 스튜디오 웹버전" → 초기 실행(core-loop)
- "Deck 기능 이식", "이미지 생성 이식" → 새 기능 실행
- "아키텍처만 다시", "웹 UI만 다시", "브리지만 다시", "검증만 다시", "재실행", "업데이트", "보완" → 부분 재실행
- 직접 호출: `open-design-port-orchestrator` 스킬 실행

### 흐름
분석(해부가) → pie-lab 통합 설계 + API 계약(설계자) → 🔴사람 승인 게이트 1 → 웹·브리지 병렬 구현 → 검증(검증자) → 🔴사람 승인 게이트 2(커밋 전) → 기록·정리.

### 팀 (일상어)
- `od-feature-analyst` — open-design 기능을 해부하는 **해부가**(읽기 전용)
- `pie-integration-architect` — pie-lab에 매핑하고 API 계약을 못 박는 **설계자**(읽기+설계)
- `web-studio-implementer` — Next.js UI를 만드는 **웹 구현자**
- `pie-agent-bridge-implementer` — pie agent 브리지·서버를 만드는 **브리지 구현자**
- `port-verifier` — 종단 동작을 따지는 **검증자**

### 주요 위치
| 목적 | 위치 |
|---|---|
| 전체 진행표(입구) | `.claude/skills/open-design-port-orchestrator/SKILL.md` |
| 작업 매뉴얼 | `.claude/skills/{od-feature-analysis, pie-integration-design, pie-web-feature-build, port-verification}/SKILL.md` |
| 팀원 역할 카드 | `.claude/agents/*.md` |
| 산출물 지도 | `artifacts/README.md` |
| 기능별 산출물 | `artifacts/ports/{feature}/` |
| 개선 기록 | `artifacts/improvement-log.md` |

## 원칙
- 코드 작성·커밋은 **청사진/설계 → 사람 승인 → 실행** 순서. 게이트 2개(설계 승인 / 커밋 전 승인)를 통과한다.
- 에이전트는 `npm run dev/build/test`를 실행하지 않는다(AGENTS.md). 검증은 `npm run check`, 종단 실행은 사람.
- 미검증·승인 대기 항목은 `사용 가능`으로 표기하지 않는다.

## 참고
- `.claude/`는 `.gitignore` 대상 → 하네스는 로컬 스캐폴드. 공유하려면 별도 트래킹 필요.

## 변경 이력
- 2026-06-19 — open-design-port 하네스 신규 구축. Agent 5 / Skill 5 / artifacts 골격.
