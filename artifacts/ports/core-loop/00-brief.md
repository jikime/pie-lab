# 00-brief — core-loop (MVP)

## 이식 대상
open-design의 **핵심 디자인 워크스페이스 루프**를 pie agent 엔진 기반 pie-lab 웹 기능으로 이식.

## 핵심 루프 (성공 정의)
웹에서:
1. brief 입력
2. 디자인 스킬 + 디자인 시스템 선택
3. pie agent가 선택한 디자인 스킬을 실행
4. 단일 페이지 HTML 아티팩트가 샌드박스 iframe에 스트리밍되어 미리보기
5. HTML 아티팩트 다운로드

여기까지가 MVP. HyperFrame(MP4)·Deck(PPTX)·이미지·비디오·Automation·Plugins·MCP·다중 프로젝트 관리는 **범위 밖**(추후 새 `{feature}`로 이식).

## 참고 원본
- open-design: `/Users/jikime/Dev/Business/promline/open-design`
  - Home 컴포저(brief + 스킬 + 디자인시스템 선택), Studio Prototype(HTML 아티팩트 + 샌드박스 iframe 미리보기), `skills/`, `CONTEXT.md`

## pie-lab 엔진
- pie agent = `packages/agent` + `packages/coding-agent`
- 로컬 서버 = `apps/server`(SSE 스트리밍 패턴 존재)
- 기존 Next.js 참고 = `apps/chat`, `apps/dashboard`

## 제약
- `AGENTS.md`: 에이전트는 `npm run dev/build/test` 실행 금지. 검증은 `npm run check`. 종단 실행은 사람.
- **코드 위치 결정됨(사용자 지정, 2026-06-19): 새 `apps/design` Next.js 앱.** 설계자는 이 위치를 전제로 02-architecture.md를 작성하고, 워크스페이스 등록·tsconfig·빌드 스크립트 편입까지 설계한다.

## 게이트 1 결정 (2026-06-19, 사용자 승인)
- ✅ `apps/design` 코드 작성 착수 승인.
- ✅ 디자인 스킬 프리셋 **1개**: `single-page-html`.
- ✅ 디자인 시스템: **자체 미니 프리셋 1~2개**(우리가 직접 쓴 중립 DESIGN.md 텍스트, 외부 발췌 없음 → 라이선스 무관).
- ✅ 포트 4878 추가, 단일 SSE 스트림, 루트 build/dev·워크스페이스 편입 진행.
- 검증은 `npm run check`만(에이전트), 종단 `npm run dev`는 사람.
