# pie-lab 최종 적용 계획 (oh-my-pi 기능)

web-first 철학 고집 X. **pie-lab에 적용 가능한 모든 것을 가져가자.**

---

## 📋 최종 선별 기준

1. **Hermes learning loop 우선** — 메모리/학습은 Hermes만 유지 (Mnemopi 제외)
2. **coding 기능은 모두 강화** — LSP, DAP, web_search 등
3. **운영 편의** — Hashline, GitHub-as-FS, Conflict, Review
4. **충돌 없으면 가져간다** — 다중 기능 OK (예: memory Hermes + LSP + DAP 동시)

---

## 🎯 최종 적용 리스트

### ✅ Tier 1 — 즉시 적용 (2-3주)

| # | 항목 | oh-my-pi | pie-lab 현황 | 효과 | 비용 | 상태 |
|---|------|----------|------------|------|------|------|
| **09** | Hashline edit | content-hash anchors | string-match edit | 토큰 61% ↓ | 중간 | ⏳ 포트 가능 |
| **10** | GitHub-as-FS | pr://, issue://, agent://, skill://, rule://, conflict:// | gh 도구 별도 | tool 통합 | 중간 | ⏳ 포트 가능 |
| **16** | Conflict resolution | conflict://N, @theirs/@ours/@base | 없음 | merge 간편 | 낮음 | ⏳ 포트 가능 |

**합계**: 3개, 비용 낮음-중간, **충돌 0**

---

### 🟡 Tier 2 — Phase 2 (4-8주, 병렬 추진 가능)

| # | 항목 | oh-my-pi | pie-lab 현황 | 효과 | 비용 | 관계 |
|---|------|----------|------------|------|------|------|
| **06** | web_search 14-provider | Exa, Brave, Jina, Kimi, Gemini, etc. + site-aware extraction | 기본 검색 또는 제한적 | 검색 품질 ↑↑ | 낮음 | 독립 |
| **02** | LSP wired | workspace/willRenameFiles, code actions, 13 ops | diagnostics 기본만 | rename/refactor ↑ | 높음 | 독립 |
| **08** | Code review | P0-P3 ranked, ship verdict, reviewer subagents | /review 도구 있음 | review 품질 ↑ | 중간 | 독립 |

**합계**: 3개, 병렬 추진, **충돌 0**

---

### 🟢 Tier 3 — Phase 2-3 (판단 필요)

| # | 항목 | oh-my-pi | pie-lab 현황 | 효과 | 비용 | 판단 |
|---|------|----------|------------|------|------|------|
| **03** | DAP debugging | lldb/dlv/debugpy (27 ops) | 없음 | debugging ↑↑ | 높음 | ⏳ **함께 진행** |
| **04** | TTSR | mid-token abort + rule inject + retry | 없음 | 학습 루프와 조합 | 높음 | ⏳ **함께 진행** |
| **14** | Commit splitter | atomic splits, dependency order, cycle reject | 기본 commit | commit quality ↑ | 중간 | ⏳ **함께 진행** |

**합계**: 3개, 추가 분석 필요, **충돌 0**

---

### ❌ 제외 (불필요 또는 경합)

| # | 항목 | 이유 |
|---|------|------|
| **11** | Hindsight/Mnemopi | **Hermes learning loop과 경합** — Hermes만 유지 |
| **01** | Dual-kernel eval | pie-lab은 chat/대시보드, REPL 필요 없음 |
| **07** | Rust native | Node.js로 충분, 이식성 > 성능 |
| **12** | ACP editor | editor 통합은 pie-lab 범위 외 |
| **18** | Browser | Telegram/Discord에서 browser 쓸 일 없음 |
| **13** | Config inheritance | 불필요 (pie-lab은 독립된 config) |
| **05** | First-class subagents | 이미 `task` 도구로 구현됨 |
| **17** | Preview then accept | 이미 `resolve` 도구로 유사 구현됨 |

---

## 📊 최종 실행 계획

### **Phase 1 (2-3주) — Tier 1**

```
1. Hashline (09)
   위치: packages/hashline/ → packages/coding-agent/src/tools/edit.ts
   인터페이스: 기존 edit 도구에 hashline 옵션 추가
   효과: 토큰 61% 절감
   
2. GitHub-as-FS (10)
   위치: oh-my-pi/packages/coding-agent/src/internal-urls/
   인터페이스: 기존 read/search에 pr://, issue:// scheme 추가
   효과: tool 통합 (gh 도구는 wrapper로 유지 가능)
   
3. Conflict resolution (16)
   위치: oh-my-pi/packages/coding-agent/src/tools/conflict-detect.ts
   인터페이스: 새 도구 `conflict` 추가
   효과: merge 간편화
```

**리스크**: 낮음 | **충돌**: 없음 | **확정도**: 높음

---

### **Phase 2 (4-8주, 병렬) — Tier 2 + Tier 3 선별**

```
A. web_search 14-provider (06)
   비용: 낮음
   충돌: 없음
   추천: ✅ 포함
   
B. LSP wired (02)
   비용: 높음
   충돌: 없음
   추천: ✅ 포함 (coding 기능 강화)
   
C. Code review 강화 (08)
   비용: 중간
   충돌: 없음
   추천: ✅ 포함 (기존 /review 확장)

D. DAP debugging (03)
   비용: 높음
   충돌: 없음
   판단: ✅ 포함하되 우선도 낮음
        (chat에서 debugger UI를 어떻게 표현할지 먼저 결정)
   
E. TTSR (04)
   비용: 높음
   충돌: 없음
   판단: ⏳ 보류
        (Hermes 학습 루프와 통합 후 rule injection 결정)
        
F. Commit splitter (14)
   비용: 중간
   충돌: 없음
   추천: ✅ 포함 (git 도구 강화)
```

**실행 우선도**:
1. web_search (06) — 낮은 비용, 높은 효과
2. Code review (08) — 중간 비용, 기존 도구 확장
3. LSP (02) — 높은 비용, 높은 효과
4. Commit (14) — 중간 비용, 낮은 우선도
5. DAP (03) — 높은 비용, UI 구현 필요
6. TTSR (04) — 보류 (Hermes와 협의 필요)

---

## 🔗 의존성 및 통합 전략

```
Phase 1:
  Hashline (09)      ← 독립
  GitHub-as-FS (10)  ← read/search 통합
  Conflict (16)      ← 독립

Phase 2:
  web_search (06)    ← 독립
  Code review (08)   ← 독립
  LSP (02)           ← 독립 (기존 LSP 확장)
  Commit (14)        ← 독립 (git 도구 확장)
  DAP (03)           ← 독립 (새 도구)
  
의존성 체크:
  ✅ GitHub-as-FS은 read/search 변경 필요 (minor)
  ✅ LSP는 기존 lsp 도구와 병렬 강화 (non-breaking)
  ✅ Code review는 /review 도구 확장 (non-breaking)
  ✅ DAP는 새 도구 (독립)
  ✅ TTSR은 streaming/rule system 필요 (나중에)
```

---

## 📈 비용-효과 분석

| Phase | 항목 | 비용 | 효과 | 기간 | 위험 |
|-------|------|------|------|------|------|
| **1** | Hashline | 중간 | 토큰 61% ↓ | 1주 | 낮음 |
| **1** | GitHub-as-FS | 중간 | tool ↓ | 1주 | 낮음 |
| **1** | Conflict | 낮음 | merge ↑ | 0.5주 | 낮음 |
| **2** | web_search | 낮음 | 검색 ↑ | 0.5주 | 낮음 |
| **2** | Code review | 중간 | review ↑ | 1주 | 낮음 |
| **2** | LSP | 높음 | refactor ↑ | 2주 | 낮음 |
| **2** | Commit | 중간 | commit ↑ | 1주 | 낮음 |
| **2** | DAP | 높음 | debug ↑↑ | 2주 | 중간 |

**전체**: Phase 1 = 2.5주, Phase 2 = 6.5주 (병렬 4주 예상)

---

## 🛠️ 구현 가이드 (위치)

| 기능 | oh-my-pi 위치 | pie-lab 위치 | 핵심 |
|------|---------------|-------------|------|
| **Hashline** | `/packages/hashline/src/` | `packages/coding-agent/src/tools/edit.ts` | content-hash anchor format |
| **GitHub-as-FS** | `/packages/coding-agent/src/internal-urls/` | `packages/coding-agent/src/internal-urls/` | URI resolver in read/search |
| **Conflict** | `/packages/coding-agent/src/tools/conflict-detect.ts` | `packages/coding-agent/src/tools/` | new tool |
| **web_search** | `/packages/coding-agent/src/tools/web-search/` | `packages/coding-agent/src/tools/web-search/` | provider chain |
| **Code review** | `/packages/coding-agent/src/tools/review.ts` | `packages/coding-agent/src/tools/review.ts` | P0-P3 ranking logic |
| **LSP** | `/packages/coding-agent/src/lsp/` | `packages/coding-agent/src/lsp/` | workspace/willRenameFiles integration |
| **Commit** | `/packages/coding-agent/src/commit/` | `packages/coding-agent/src/commit/` | dependency ordering |
| **DAP** | `/packages/coding-agent/src/dap/` | `packages/coding-agent/src/dap/` | debug protocol ops |

---

## ✅ 최종 결정 사항

| 항목 | 결정 | 시기 | 비고 |
|------|------|------|------|
| **Hashline** | ✅ 포함 | Phase 1 | 토큰 절감 최우선 |
| **GitHub-as-FS** | ✅ 포함 | Phase 1 | tool 통합 |
| **Conflict** | ✅ 포함 | Phase 1 | merge 편의 |
| **web_search** | ✅ 포함 | Phase 2 | 검색 품질 |
| **Code review** | ✅ 포함 | Phase 2 | 기존 도구 강화 |
| **LSP** | ✅ 포함 | Phase 2 | coding 기능 확대 |
| **Commit** | ✅ 포함 | Phase 2 | git 도구 강화 |
| **DAP** | ✅ 포함 | Phase 2-3 | UI 구현 후 결정 |
| **TTSR** | ⏳ 보류 | Phase 3+ | Hermes + learning loop 협의 필요 |
| **Hermes** | ✅ 유지 | — | 메모리는 Hermes만 (Mnemopi 제외) |

---

## 🎯 요약

**최종 선택: 9가지 기능** (TTSR 제외)

| Phase | 기능 수 | 기간 | 우선도 |
|-------|--------|------|--------|
| **Phase 1** | 3개 (Hashline, GitHub-as-FS, Conflict) | 2-3주 | 🔴 |
| **Phase 2** | 5개 (web_search, review, LSP, commit, DAP) | 4-6주 | 🟡 |
| **Phase 3+** | 1개 (TTSR, Hermes와 협의 후) | TBD | 🟢 |

**철학**:
- Hermes learning loop 우선 (메모리는 Hermes만)
- coding 기능은 모두 강화 (LSP, DAP 포함)
- 운영 편의는 모두 가져가기 (Hashline, GitHub-as-FS, Conflict, web_search)
- 충돌 없으면 다중 기능 OK
