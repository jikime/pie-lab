# oh-my-pi "18 Features" → pie-lab 적용 계획

oh-my-pi README의 "The Pi you love, with batteries included" 18가지 항목 중 **pie-lab에 적용할 가치 있는 것**을 우선순위별로 정리.

---

## 🔴 High Priority (즉시 실행 가능, 높은 가치)

### 1️⃣ 09 — Hashline: edit by content hash
**현황**: pie-lab은 기존 string-match edit 사용  
**oh-my-pi**: content-hash anchors → 토큰 61% 절감, 정확도 향상  
**비용**: 중간 (packages/hashline 포트)  
**효과**: 비용 대시보드에 즉시 영향  
**상태**: ⏳ 준비됨 (oh-my-pi/packages/hashline 완성)

→ **Priority 1: 이걸 먼저 하자**

---

### 2️⃣ 10 — GitHub is just another filesystem
**현황**: pie-lab은 `gh` 도구 별도  
**oh-my-pi**: `pr://`, `issue://`, `agent://`, `skill://`, `rule://`, `conflict://` URI  
**비용**: 중간 (internal-urls/ 포트)  
**효과**: tool sprawl 축소, read/search 통합  
**상태**: ⏳ oh-my-pi에서 성숙함

→ **Priority 2: Hashline 다음**

---

### 3️⃣ 04 — Time-traveling stream rules (TTSR)
**현황**: pie-lab은 없음  
**oh-my-pi**: Mid-token abort → rule inject → retry from same point  
**비용**: 높음 (streaming pipeline 수정)  
**효과**: 학습 루프와 자연스럽게 적합 (rule 자동 생성 시)  
**상태**: ✅ oh-my-pi에서 Experimental→Stable

→ **Priority 3: 학습 루프 강화 시점**

---

### 4️⃣ 16 — Conflict resolution, made easy
**현황**: pie-lab은 없음  
**oh-my-pi**: `conflict://N`, `@theirs`, `@ours`, `@base`, `conflict://*`  
**비용**: 낮음 (conflict-detect.ts 포트)  
**효과**: merge conflict를 clean하게 처리  
**상태**: ✅ oh-my-pi에서 안정적

→ **Phase 1에 추가 가능**

---

## 🟡 Medium Priority (계획된 작업과 조합)

### 5️⃣ 02 — LSP wired into every write
**현황**: pie-lab은 LSP 부분적 (diagnostics만)  
**oh-my-pi**: workspace/willRenameFiles, code actions, raw requests (13 ops)  
**비용**: 높음  
**효과**: rename → re-exports, barrel, aliases 자동 업데이트  
**상태**: ✅ oh-my-pi에서 성숙함  
**참고**: 최근 pie-lab streaming 수정과 관련 없음

→ **Phase 2**

---

### 6️⃣ 03 — Drives a real debugger (DAP)
**현황**: pie-lab은 없음  
**oh-my-pi**: 27 DAP ops (lldb, dlv, debugpy)  
**비용**: 높음 (coding-agent/src/dap/ 포트 + 통합)  
**효과**: 진정한 debugging 경험 (지금은 print-debug만)  
**상태**: ✅ oh-my-pi에서 성숙함  
**가치**: 코딩 에이전트의 단일 가장 큰 gap

→ **Phase 2**

---

### 7️⃣ 06 — Read a pdf on arxiv (web_search 14-provider)
**현황**: pie-lab은 기본 web_search (단일 또는 제한적)  
**oh-my-pi**: 14-provider chain (Exa, Brave, Jina, Kimi, Anthropic, Gemini, etc.)  
**비용**: 낮음  
**효과**: 검색 품질 향상, site-aware extraction (GitHub, arXiv, SO, docs)  
**상태**: ✅ oh-my-pi에서 성숙함

→ **Phase 1에 추가 가능** (time permitting)

---

### 8️⃣ 17 — Preview, then accept
**현황**: pie-lab은 `resolve` tool로 유사 구현  
**oh-my-pi**: ast_edit returns _(proposed)_ → resolve accepts  
**비용**: 낮음 (이미 있음)  
**효과**: 변경 안전성 향상  
**상태**: ✅ 기존 패턴 활용

→ **이미 있음**

---

### 9️⃣ 18 — Drives a real browser (또는 Slack)
**현황**: pie-lab은 없음  
**oh-my-pi**: Puppeteer (headless Chromium + CDP-attached Electron)  
**비용**: 중간  
**효과**: web 자동화, external app 제어 (Slack, etc.)  
**상태**: ✅ oh-my-pi에서 성숙함

→ **Phase 2**

---

## 🟢 Low Priority (아키텍처 특화, 높은 비용)

### 10 — 01 Code execution w/ tool-calling (dual-kernel eval)
**현황**: pie-lab은 없음  
**oh-my-pi**: Python + Bun kernels, loopback tool re-entry  
**비용**: 높음 (kernel 구현)  
**효과**: 인터프리터 세션의 tool 접근  
**상태**: ✅ oh-my-pi에서 성숙함  
**트레이드**: 복잡도 vs 가치 — chat 중심 pie-lab에는 낮은 우선도

→ **Phase 3** (원하면)

---

### 11 — 07 Unapologetically native (Rust core)
**현황**: pie-lab은 Node.js 전용  
**oh-my-pi**: ~27k Rust, NAPI (grep, shell, AST, PTY, iso)  
**비용**: 매우 높음 (플랫폼 통합)  
**효과**: 성능 (이미 충분한가?)  
**상태**: ✅ oh-my-pi에서 성숙함  
**판단**: pie-lab이 성능 병목 없으면 불필요

→ **Pass for now** (성능 문제 발생 시만)

---

### 12 — 08 Code review with priorities
**현황**: pie-lab은 `/review` 도구 있음  
**oh-my-pi**: P0–P3 ranked, ship verdict, reviewer subagents  
**비용**: 낮음 (도구 강화)  
**효과**: 기존 review 도구 개선  
**상태**: ✅ pie-lab에 유사 있음

→ **Enhanced in Phase 2**

---

### 13 — 05 First-class subagents
**현황**: pie-lab은 `task` 도구로 이미 있음  
**oh-my-pi**: 격리된 worktree, schema-validated results  
**비용**: 낮음 (이미 있음)  
**효과**: 기존 기능 활용  
**상태**: ✅ 기존 구현 유지

→ **이미 있음**

---

### 14 — 11 Hindsight: memory the agent curates
**현황**: pie-lab은 Hermes 학습 루프 (다른 방식)  
**oh-my-pi**: retain/recall/reflect, mental models  
**비용**: 높음 (메모리 시스템 재설계)  
**효과**: long-term memory 개선  
**상태**: ✅ oh-my-pi에서 성숙함, pie-lab은 다른 접근  
**판단**: pie-lab의 Hermes 학습 루프와의 경합

→ **Phase 3** (선택)

---

### 15 — 12 ACP: editor-drivable agent
**현황**: pie-lab은 web-first (editor ACP 아님)  
**oh-my-pi**: Zed/editor integration, JSON-RPC ACP  
**비용**: 높음  
**효과**: editor 통합 (pie-lab 관점에선 낮은 우선도)  
**상태**: ✅ oh-my-pi에서 성숙함  
**판단**: pie-lab의 web-first 철학과 맞지 않음

→ **Pass** (web-first 전략 유지)

---

### 16 — 13 Inherits what your other tools already wrote
**현황**: pie-lab은 부분적 (일부 config 상속)  
**oh-my-pi**: Cursor, Cline, Codex, Copilot, `.agents/` 등 자동 발견  
**비용**: 낮음 (config 로더 강화)  
**효과**: 기존 config 재사용  
**상태**: ✅ oh-my-pi에서 성숙함

→ **Phase 1 또는 2**

---

### 17 — 14 omp commit: atomic splits, validated messages
**현황**: pie-lab은 기본 commit 도구  
**oh-my-pi**: git-overview, dependency ordering, cycle rejection  
**비용**: 중간  
**효과**: commit quality 향상  
**상태**: ✅ oh-my-pi에서 성숙함

→ **Phase 2**

---

### 18 — 15 Read PRs. Walk skills. Pull JSON out of subagents.
**현황**: pie-lab은 부분적 (agent:// scheme 있음)  
**oh-my-pi**: 10개 internal schemes (pr://, issue://, agent://, skill://, rule://, conflict://, etc.)  
**비용**: 중간  
**효과**: tool sprawl 축소 (10번과 조합)  
**상태**: ✅ oh-my-pi에서 성숙함

→ **Priority 2와 조합**

---

## 📋 실행 계획 (3 Phase)

### **Phase 1 — High ROI, Quick Wins (2-4주)**

| # | Feature | oh-my-pi | 난이도 | 효과 | 실행 |
|---|---------|----------|--------|------|------|
| 1 | 09 Hashline | content-hash edit | 중간 | 토큰 61% ↓ | ⏳ 시작 가능 |
| 2 | 10 GitHub-as-FS | pr://, issue://, etc. | 중간 | tool sprawl ↓ | ⏳ 시작 가능 |
| 3 | 16 Conflict resolution | conflict://N | 낮음 | merge ↑ | ⏳ 시작 가능 |
| 4 | 06 web_search 14-provider | provider chain | 낮음 | 검색 품질 ↑ | ⏳ 시작 가능 |
| 5 | 13 Config inheritance | discovery | 낮음 | 호환성 ↑ | ⏳ 시작 가능 |

---

### **Phase 2 — Medium ROI, Capability Gaps (4-8주)**

| # | Feature | oh-my-pi | 난이도 | 효과 | 단계 |
|---|---------|----------|--------|------|------|
| 6 | 02 LSP wired | workspace/willRenameFiles | 높음 | refactor ↑ | 병렬 |
| 7 | 03 DAP debugging | lldb/dlv/debugpy | 높음 | debug ↑↑ | 병렬 |
| 8 | 04 TTSR | mid-token abort+inject | 높음 | 학습 루프 ↑ | 직렬 |
| 9 | 18 Browser | Puppeteer + Slack | 중간 | 자동화 ↑ | 병렬 |
| 10 | 14 omp commit | atomic split | 중간 | commit quality ↑ | 병렬 |

---

### **Phase 3 — Long-tail, Optional (선택)**

| # | Feature | oh-my-pi | 난이도 | 효과 | 판단 |
|---|---------|----------|--------|------|------|
| 11 | 01 Dual-kernel eval | loopback tool re-entry | 높음 | 중간 | 선택 |
| 12 | 11 Mnemopi memory | recall/reflect | 높음 | 낮음* | Hermes와 경합 |
| 13 | 07 Rust native | NAPI core | 매우 높음 | 성능 | 불필요** |
| 14 | 12 ACP editor | JSON-RPC | 높음 | 낮음*** | web-first 외 |

*Hermes 학습 루프와 경합, 통합 필요  
**현재 성능 병목 없음  
***web-first 전략 유지

---

## 🎯 최종 추천 시작점

**지금 바로**:
```
1. Hashline (09) 포트 → 토큰 61% 절감 가시적 효과
2. GitHub-as-FS (10) + Conflict resolution (16) 조합 → tool 정리
```

**2-3주 후**:
```
3. web_search (06) 14-provider, Config inheritance (13) 추가
```

**다음 분기**:
```
4. LSP/DAP (02, 03) — 코딩 에이전트 capability gap 최소화
5. TTSR (04) — 학습 루프 skill generation과 조합
```

---

## 📊 영향도 매트릭스

```
     가치 (효과)
        ↑
   [09] [10]        ← High ROI, Low Effort
    ↓     ↓
[04] ←[TTSR]→ [02,03]  ← Medium ROI
           ↓
      [01,07,11,12]  ← Low ROI or High Cost
```

**선택 기준**: 
- 🔴 Red (High ROI + Low Effort) → Phase 1 즉시 실행
- 🟡 Yellow (Medium ROI) → Phase 2, 병렬 추진
- 🟢 Green (Low ROI / High Cost) → 선택 또는 연기

---

## 참고 (oh-my-pi 원본 위치)

```
Hashline       → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/hashline/
GitHub-as-FS   → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/internal-urls/
Conflict       → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/tools/conflict-detect.ts
web_search     → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/tools/web-search/
LSP            → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/lsp/
DAP            → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/dap/
TTSR           → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/export/ttsr.ts
Browser        → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/tools/browser/
Config inherit → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/legacy-pi-*-shim.ts
Commit split   → /Users/jikime/Dev/Business/Projects/passive-income/oh-my-pi/packages/coding-agent/src/commit/
```
