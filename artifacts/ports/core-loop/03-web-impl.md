# 03-web-impl — core-loop 웹 구현자 노트

> 입력: `00-brief.md`(게이트 1 결정), `02-architecture.md`(⭐ 4절 API 계약 = 단일 진실 원천).
> 스코프: `apps/design/**` 만. 서버·packages·루트 빌드 편입은 **건드리지 않음**(브리지 구현자 영역).
> 검증: `eslint`(green) + `tsgo --noEmit`(green). **`next build`/`dev`는 미실행**(AGENTS.md 금지) — 종단은 사람.

---

## 1. 만든 파일 목록 (`file:line` = 주요 진입점)

### 설정/스캐폴드 (`apps/chat` 복제 기준, 디자인 루프 불필요 의존 제거)
- `apps/design/package.json:1` — `@pie-lab/design`, dev 포트 **4878**. 의존은 chat의 부분집합(next/react/radix/tailwind/lucide/clsx/cva/tailwind-merge). discord/gondolin/markdown/pretendard/shadcn **제외**. 새 외부 의존 0(전부 레포 기존 버전).
- `apps/design/tsconfig.json:1` — chat tsconfig 그대로(`paths:{"@/*":["./src/*"]}`, next plugin, `moduleResolution:bundler`).
- `apps/design/next.config.ts:1`, `postcss.config.mjs:1`, `eslint.config.mjs:1`, `next-env.d.ts:1` — chat 동일.

### 공유 타입 (정본)
- `apps/design/src/lib/design-protocol.ts:1` — **02-architecture 4.0 절과 1:1 미러**. `DesignOptionsResponse`/`DesignRunRequest`/`DesignStreamEvent` 유니온(`start|progress|text|artifact|done|error`)/`ArtifactDescriptor`/`DesignRunStatusResponse`. 서버는 이 파일을 import하지 않고 구조 미러(7.1 결정) — 웹은 단독 변경 금지 명시 주석 포함.

### API 클라이언트
- `apps/design/src/lib/design-api.ts:78` — `streamDesignRun()`: `POST /v1/design/runs` + `fetch()+getReader()+버퍼 \n\n 분리`(chat-api.ts 패턴 그대로, native EventSource 아님). `[DONE]` 스킵. 헤더 `x-pie-client-origin: pie-design:web`.
  - `fetchDesignOptions()` (`GET /v1/design/options`), `fetchRunStatus()` (`GET /v1/design/runs/:id`, 폴백용 — 현재 UI에서 호출 안 함, 재진입 대비 노출만), `artifactUrl(runId,name,download)` (4.4 raw 서빙/`?download=1`), `resolveArtifactUrl()`(서버가 상대 url 줄 경우 base 기준 정규화).
  - 기준 URL: `process.env.NEXT_PUBLIC_PIE_API_BASE_URL ?? "http://127.0.0.1:4873"`.
- `apps/design/src/lib/srcdoc.ts:14` — `buildSrcdoc()` 최소 추출(baseHref/edit-mode 브리지 제외). 완성 문서면 그대로, 부분 HTML이면 최소 문서로 래핑.
- `apps/design/src/lib/utils.ts:5` — `cn()` (clsx+tailwind-merge).

### UI 컴포넌트
- `apps/design/src/app/layout.tsx:1`, `globals.css:1` — tailwind v4 + tw-animate-css 만(shadcn/pretendard 의존 제거, 자체 토큰).
- `apps/design/src/app/page.tsx:1` — Home. 옵션 로드 → 컴포저 → 스트림 소비 → 미리보기 오케스트레이션. `onEvent`에서 `start`(runId 저장)/`progress`(라벨)/`text`(누적)/`artifact`(streaming→complete 반영)/`done`(phase+최종 artifacts)/`error`(메시지) 처리. 좌측 컴포저+상태, 우측 sticky 미리보기 2열.
- `apps/design/src/components/Composer.tsx:23` — brief `<textarea>`(Lexical→축소) + Skill/DesignSystem select + Run/중지. ⌘/Ctrl+Enter 실행.
- `apps/design/src/components/SkillPicker.tsx:13` — 디자인 스킬 단일 select. **옵션은 서버에서**(하드코딩 없음). 선택 description 표시.
- `apps/design/src/components/DesignSystemPicker.tsx:17` — `null="지정 안 함"`(빈 문자열↔null 매핑, 계약 4.0 `designSystemId: string|null`).
- `apps/design/src/components/RunStream.tsx:16` — 실행/스트리밍 상태(running/succeeded/failed/aborted) + 최신 progress 라벨 + 누적 text + error.
- `apps/design/src/components/ArtifactPreview.tsx:21` — 샌드박스 `iframe`. `sandbox="allow-scripts allow-downloads"` **고정**(allow-same-origin 금지, 6.3). 미리보기 우선순위 = `inlineHtml` 있으면 srcDoc, 없으면 `url` fetch(4.6). 새 탭(`url`)·다운로드(`?download=1`) 링크. streaming 배지/bytes 표시.

---

## 2. 계약 준수 체크포인트 (검증자가 볼 곳)

- **SSE 소비**: `design-api.ts:streamDesignRun` — `data: <json>\n\n` 프레이밍, `[DONE]` 종료, AbortController 취소(4.1 취소 규약과 호환; `fetch` abort → 서버 `response.on("close")`).
- **이벤트 순서 가정**: `page.tsx:handleStreamEvent`는 순서 무가정으로 안전(각 타입 독립 처리). `artifact` streaming→complete를 동일 setter로 덮어써 마지막이 primary. `done.artifacts` 마지막을 최종 primary로.
- **샌드박스**: `ArtifactPreview.tsx` iframe `sandbox` 속성이 정확히 `allow-scripts allow-downloads`인지 확인.
- **다운로드**: `artifactUrl(runId, name, true)` → `…/artifact/<name>?download=1`(4.4/4.5).
- **옵션 출처**: skills/designSystems 모두 `/v1/design/options` 응답에서만 채움 — 프론트 하드코딩 0.
- **client-origin 헤더**: 모든 호출에 `x-pie-client-origin: pie-design:web`(3.3).

---

## 3. 결정 사항 (웹 범위 내, 계약 미변경)

1. **globals.css 자체 토큰화**: chat의 globals는 `pretendard`/`shadcn`/`tw-animate-css` import에 의존. 디자인 앱 의존 부분집합 원칙(6.1)에 맞춰 pretendard/shadcn 제거하고 tailwind v4 + tw-animate-css만으로 중립 토큰을 직접 정의. → 외부 폰트/컴포넌트 의존 0.
2. **radix-ui select 미사용**: 단일 select 2개라 native `<select>`로 충분 → 접근성·번들 단순화. radix-ui는 package.json 의존엔 남겨둠(후속 다이얼로그 등 확장 여지). 사용 안 하면 후속 제거 가능 — 검증자 판단 영역.
3. **effect 내 동기 setState 금지 대응**: Next 16 / react-hooks 신규 룰(`set-state-in-effect`)이 effect 본문 동기 setState를 error로 막음 → 옵션 로드/미리보기 fetch effect를 async IIFE로 감싸 상태 갱신을 콜백 안으로 이동. 초기 `optionsLoading=true` 활용해 동기 set 제거. 동작 동일, 계약 무관.
4. **`fetchRunStatus` 노출만**: 4.3 재진입 폴백 API 클라이언트는 구현했으나 MVP UI에선 미사용(새로고침 재개는 MVP 비범위, 4.1 결정). 후속 feature가 바로 쓸 수 있게 남김.

---

## 4. `확인 필요` / 미완 / 경계 밖(브리지·사람 작업)

- **[확인 필요 — 브리지] `ArtifactDescriptor.url` 형태**: 계약 4.0 주석은 `url`을 `/v1/design/runs/<runId>/artifact/<name>` **상대 경로 패턴**으로 적었으나 절대/상대 명시는 모호. 웹은 `resolveArtifactUrl()`로 **둘 다 허용**(절대 http(s)면 그대로, 아니면 `API_BASE_URL` prefix). 서버가 절대 URL을 다른 host로 줄 가능성은 없다고 가정. → 서버 구현이 상대 경로로 주면 그대로 동작.
- **[경계 밖 — 브리지/사람] 워크스페이스 빌드/실행 편입**: 루트 `package.json` build·`dev:start` 편입과 `scripts/kill-dev-ports.mjs` 4878 추가는 02-architecture 2.4/3.2상 **브리지 구현자(파일) + 사람(실행)** 책임. 웹 범위 밖이라 **건드리지 않음**. dev 포트는 `apps/design/package.json`에 4878로 박아둠.
- **[사람] 의존성 설치/lockfile**: 새 워크스페이스라 `node_modules` 미설치 상태(AGENTS.md상 lockfile 변경은 `npm install --package-lock-only --ignore-scripts` + 사람 커밋). 검증은 루트 hoisted eslint/tsgo로 수행(green). `npm run check`(=`eslint && next build`)의 **next build는 사람**이 종단 실행.
- **[설계 가정] `done` 없이 스트림이 끊길 때**: 정상 종료는 `done`+`[DONE]` 보장(4.1). 네트워크 중단 시 stream loop가 그냥 끝나면 phase가 `running`에 머물 수 있음 → 사용자가 "중지"로 복구 가능. MVP 허용 범위로 둠(타임아웃 미구현).
- **미구현(MVP 범위 밖)**: ZIP/PDF 내보내기(4.5 제외), 새로고침 후 런 재구독, 다중 아티팩트 탭(가장 최근 1개만 primary 미리보기 — 6.3 위험 완화안과 일치).

---

## 5. 검증 결과
- `apps/design`에서 `eslint` → 통과(0 errors/0 warnings).
- `tsgo --noEmit -p tsconfig.json` → 통과(타입 오류 0).
- `next build`/`dev`/`test` 미실행(AGENTS.md 금지). 종단 빌드·실행은 사람.
