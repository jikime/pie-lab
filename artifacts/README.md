# artifacts — open-design-port 산출물 지도

open-design 기능을 pie agent 기반 pie-lab 웹 기능으로 이식하는 하네스의 산출물이 여기 모인다.
입구는 `open-design-port-orchestrator` 스킬. 각 기능은 `ports/{feature}/` 폴더 한 개를 갖는다.

## 폴더 구조
```
artifacts/
├─ README.md            ← 이 지도
├─ improvement-log.md   ← 실행 후 배운 점·개선 기록
└─ ports/
   └─ {feature}/
      ├─ 00-brief.md          (입력) 이식 대상·범위
      ├─ 01-od-analysis.md    해부가 산출 — open-design 기능 해부
      ├─ 02-architecture.md   설계자 산출 — pie-lab 매핑 + API 계약  [게이트 1 입력]
      ├─ 03-web-impl.md       웹 구현자 노트 (+ apps/studio 코드)
      ├─ 04-bridge-impl.md    브리지 구현자 노트 (+ apps/server·packages 코드)
      └─ 05-verification.md   검증자 산출 — 종단 검증           [게이트 2 입력]
```
실제 코드는 pie-lab 트리(`apps/studio`, `apps/server`, `packages/*`)에 들어간다. 위 `.md`는 그 코드의 설계·근거·검증 기록이다.

## 산출물 계약
| 파일 | 만든 역할 | 다음에 읽는 역할 | 상태 |
|---|---|---|---|
| `00-brief.md` | 사용자/Orchestrator | 해부가 | — |
| `01-od-analysis.md` | od-feature-analyst | pie-integration-architect | — |
| `02-architecture.md` | pie-integration-architect | 웹·브리지 구현자, 검증자 | — |
| `03-web-impl.md` | web-studio-implementer | port-verifier | — |
| `04-bridge-impl.md` | pie-agent-bridge-implementer | port-verifier | — |
| `05-verification.md` | port-verifier | 사용자(게이트 2) | — |

## 진행 현황
| feature | 단계 | 최신 산출물 | 승인 상태 |
|---|---|---|---|
| core-loop | 구현·검증 완료(B-1 닫힘), 게이트 2 대기 | `05-verification.md` | 🔴 사람 승인 게이트 2 대기(커밋 전). 에이전트 검증범위=사용 가능 / 종단=사람 승인 필요 |

## 규칙
- 앞 단계 산출물이 바뀌면 뒤 단계는 `stale`/`needs-review`로 표시하고 그대로 최종 판단에 쓰지 않는다.
- 외부 발송·커밋·머지·푸시 등 종료 행동은 **사람 승인 후에만**. 미승인 항목은 `사람 승인 필요`로 남긴다.
- 종단 `npm run dev` 실행·브라우저 확인은 사람 단계(AGENTS.md: 에이전트는 dev/build/test 실행 금지).
