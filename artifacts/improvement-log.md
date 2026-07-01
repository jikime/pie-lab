# improvement-log — open-design-port 하네스

실행 후 배운 점, 실패, 사용자 피드백을 모아 다음번 하네스를 작게 고치는 근거로 쓴다.

## 형식
각 항목: 날짜 · 무엇을 실행 · 무엇이 잘/안 됐는지 · 다음에 바꿀 점 · 대상 파일.

## 기록
- 2026-06-19 — 하네스 신규 구축. Agent 5(해부가·설계자·웹 구현자·브리지 구현자·검증자) / Skill 5(orchestrator + 분석·설계·구현·검증) / `artifacts/` 골격 생성.
  - 설계 결정: 실제 코딩까지 수행하는 두꺼운 하네스, 기능 이식 공장(첫 실행 = core-loop MVP).
  - 제약 반영: `AGENTS.md`의 `npm run dev/build/test` 금지 → 종단 실행을 사람 단계로 분리, 검증은 `npm run check`.
  - 주의: `.claude/`가 `.gitignore`에 포함됨 → 하네스는 로컬 스캐폴드. 공유하려면 별도 트래킹 필요.
- 2026-06-19 — core-loop MVP 첫 실행. 분석→설계→게이트1 승인(위치 `apps/design`·스킬 1개·자체 디자인시스템 프리셋)→웹·브리지 병렬 구현→검증.
  - 결과: 차단 결함 0, `npm run check` green(biome 733파일 0/tsgo 0/design 앱 tsgo exit 0). 계약 1:1 미러, 원본 핵심 루프 5단계 모두 이식.
  - 4↔5 루프 1회: 검증자가 B-1(write 결과 파싱이 hashline note에 취약 → 아티팩트 누락 위험) 발견 → 브리지가 `toolCallId` 기반 `args.path` 1순위 + 정규식 교체로 보강 → 재검증 닫힘.
  - 잘 된 점: API 계약을 설계자가 못 박으니 웹·브리지가 서로 안 보고 병렬 구현해도 경계면 위반 0. 검증자의 경계면 교차검증이 B-1을 잡음.
  - 다음에 바꿀 점: 종단 실행(`npm run dev`)이 사람 전용이라 "실제 모델 런·미리보기 렌더"는 미검증으로 남음 — 향후 webapp-testing(Playwright) 보조 검증 단계 추가 검토.
  - 미검증 영역(게이트 2 이후 사람 종단): `next build` 풀빌드, 실제 pie agent 런, 다운로드 첨부 헤더 브라우저 거동.
