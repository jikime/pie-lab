# pie-lab 현실적 개선점 분석

oh-my-pi와의 충돌을 피하고, **pie-lab 자체 전략 내에서** 정말 필요한 것만 선별.

---

## 📌 pie-lab의 기본 전략 재확인

| 항목 | pie-lab | oh-my-pi | 충돌? |
|------|---------|----------|--------|
| **주 진출지** | 웹 (Next.js chat + dashboard) | 터미널 (TUI) | ✅ No |
| **모델 라우팅** | 9-route (비용 중심) | 40+ provider (기능 중심) | ⚠️ 다른 목표 |
| **메모리/학습** | Hermes learning loop | Mnemopi (recall/retain) | 🚨 **경합** |
| **멀티채널** | Telegram + Discord + Web | 없음 (터미널만) | ✅ No |
| **네이티브** | Node.js 기반 | Rust 27k줄 | ✅ No (diff 전략) |
| **에디터 통합** | 없음 (web-first) | ACP (Zed 지원) | ✅ No |

---

## 🔍 oh-my-pi 18개 항목 재평가 (pie-lab 관점)

### ❌ 버려야 할 것 (pie-lab 전략과 충돌)

| # | 항목 | 이유 |
|---|------|------|
| **11** | Hindsight 메모리 | **Hermes 학습 루프와 경합** — 메모리/skill 생성 전략이 다름. 양쪽 모두 구현하면 중복 + 복잡도 |
| **12** | ACP (editor-drivable) | **web-first 전략 위배** — pie-lab은 웹/chat 중심, 에디터는 미래 과제 |
| **07** | Rust native core | **이식성 감소** — pie-lab은 Node.js로 유지하는 게 여러 플랫폼에서 낫다 |
| **01** | Dual-kernel eval | **pie-lab은 필요 없음** — chat/대시보드 서비스이지, REPL이 아님 |

---

### ✅ 고려할 가치 있는 것

#### **Tier 1 — 즉시 적용 가능, 충돌 없음**

| # | 항목 | 현황 | 효과 | 적용 |
|---|------|------|------|------|
| **09** | Hashline edit | edit 도구가 string-match 사용 중 | 토큰 61% ↓, 비용 절감 | ✅ 포트 가능 |
| **10** | GitHub-as-FS | gh 도구 별도 존재 | tool 통합, 복잡도 ↓ | ✅ 포트 가능 |
| **16** | Conflict resolution | 없음 | merge 간편화 | ✅ 포트 가능 |
| **13** | Config inheritance | 부분 있음 | Cursor/Cline/Codex 자동 발견 | ✅ 강화 가능 |

**판단**: **4개 모두 적용 권장**  
**비용**: 2-3주, **충돌 0**

---

#### **Tier 2 — 검토 필요, 부분 적용**

| # | 항목 | 현황 | 이슈 | 판단 |
|---|------|------|------|------|
| **06** | web_search 14-provider | 검색 있음 (기본 또는 제한적) | 품질 향상 vs 복잡도 | ⚠️ **선택** |
| **02** | LSP wired | LSP 도구 있음 (진단만) | workspace/willRenameFiles 추가 | ⚠️ **선택** |
| **08** | Code review | `/review` 도구 있음 | P0-P3 ranking 강화 | ⚠️ **선택** |
| **17** | Preview then accept | `resolve` 도구 있음 | 기존과 유사 | ⚠️ **이미 있음** |

**판단**: 각각 **독립적 의사결정**, 충돌 없음

---

#### **Tier 3 — 높은 비용, 낮은 우선도**

| # | 항목 | 이유 | 상태 |
|---|------|------|------|
| **03** | DAP debugging | pie-lab은 터미널이 아니라 web chat | chat에서 debugger 필요한가? 🤔 | 🟡 **검토 필요** |
| **04** | TTSR | 강력하지만, 학습 루프와 어떻게 연동? | Hermes와의 rule injection 경합 | 🟡 **먼저 Hermes 확인** |
| **14** | Commit splitter | git 도구 있음 | 강화 가능하지만 급하지 않음 | 🟢 **낮은 우선도** |
| **18** | Browser | pie-lab은 web 서비스, browser 도구 필요 없음 | Telegram/Discord에서 쓸 일 없음 | 🟢 **불필요** |
| **05** | First-class subagents | `task` 도구 이미 있음 | 이미 구현됨 | ✅ **이미 있음** |

---

## 🎯 현실적 실행 계획

### **Phase 1 — 즉시 실행 (2-3주, 충돌 0)**

```
1. Hashline (09)
   - 비용: 낮음-중간 (packages/hashline 포트)
   - 효과: 토큰 61% 절감 → 즉시 비용 감소
   - 위험: 거의 없음 (기존 edit와 병렬 또는 대체)

2. GitHub-as-FS (10)
   - 비용: 중간 (internal-urls 포트)
   - 효과: pr://, issue:// 통합 → tool sprawl 축소
   - 위험: 거의 없음 (기존 gh 도구와 겹칠 수 있음 → `read pr://1428` 우선)

3. Conflict resolution (16)
   - 비용: 낮음
   - 효과: merge conflict 처리 간편화
   - 위험: 없음 (새 기능)

4. Config inheritance (13)
   - 비용: 낮음 (config 로더 강화)
   - 효과: Cursor/Cline/.agents/ 발견
   - 위험: 없음 (이미 일부 있음)
```

**총합**: 4개, 2-3주, **이득만 있음**

---

### **Phase 2 — 선택사항 (pie-lab 우선도 따라)**

**웹_search 14-provider (06)**
```
판단: 선택
이유:
  - 현재 web_search가 약하면: 추가 (비용 낮음)
  - 현재 충분하면: Skip

비용: 낮음 (provider 체인 추가)
충돌: 없음
```

**LSP 강화 (02)**
```
판단: 선택
이유:
  - pie-lab의 coding 기능이 약하면: 고려
  - chat/대시보드 중심이면: Skip

비용: 중간-높음 (workspace/willRenameFiles 통합)
충돌: 없음 (기존 LSP와 병렬)
```

**Code review 강화 (08)**
```
판단: 선택
이유:
  - 이미 `/review` 도구 있음
  - P0-P3 ranking은 nice-to-have

비용: 낮음
충돌: 없음
```

---

### **❌ Phase 3 — 버릴 것**

```
❌ Hindsight/Mnemopi (11)
   이유: Hermes learning loop과 충돌
   해결책: Hermes를 먼저 평가 후, 필요하면 메모리 layer 추가
          (양쪽 동시 도입 X)

❌ ACP editor (12)
   이유: web-first 전략 위배
   미래: 에디터 지원이 필요해지면 나중에

❌ Rust native (07)
   이유: Node.js로 충분, 이식성 감소
   미래: 성능 병목 발생 시 선택적 NAPI

❌ Dual-kernel eval (01)
   이유: chat/대시보드 서비스에 불필요
   미래: 개발자용 REPL 필요하면 나중에

❌ Browser (18)
   이유: Telegram/Discord에서 browser 쓸 일 없음
   미래: 불필요 (web-first)

❌ DAP (03)
   이유: TUI 없으니 debugger UI를 어디에?
   판단: 우선도 낮음. chat에서 debugger가 필요한 use-case 없음
```

---

## 📊 최종 판정 매트릭스

| 항목 | oh-my-pi | pie-lab 필요성 | 충돌? | 권장 |
|------|----------|--------------|--------|------|
| 09 Hashline | ✅ 성숙 | 🔴 High (토큰 절감) | No | ✅ **즉시** |
| 10 GitHub-as-FS | ✅ 성숙 | 🔴 High (tool 정리) | No | ✅ **즉시** |
| 16 Conflict | ✅ 성숙 | 🟡 Medium | No | ✅ **함께** |
| 13 Config inherit | ✅ 성숙 | 🟡 Medium | No | ✅ **함께** |
| 06 web_search | ✅ 성숙 | 🟡 Medium | No | ⚠️ **선택** |
| 02 LSP | ✅ 성숙 | 🟢 Low* | No | ⚠️ **선택** |
| 08 Review | ✅ 성숙 | 🟢 Low | No | ⚠️ **선택** |
| 11 Memory | ✅ 성숙 | 🚨 **경합** | **Yes** | ❌ **제외** |
| 12 ACP | ✅ 성숙 | 🟢 Very Low | Yes | ❌ **제외** |
| 03 DAP | ✅ 성숙 | 🟢 Very Low | Maybe | ❌ **제외** |
| 07 Rust | ✅ 성숙 | 🟢 Very Low | Maybe | ❌ **제외** |
| 01 Eval | ✅ 성숙 | 🟢 Very Low | No | ❌ **제외** |

*chat 중심 서비스이므로, rename/refactor 기능은 agent의 coding 능력이지 pie-lab 자체는 아님

---

## 🎯 최종 권장

### **즉시 실행 (2-3주)**
```
1. Hashline (09)        ← 토큰 61% 절감, 즉시 비용 효과
2. GitHub-as-FS (10)    ← tool 통합, 간편화
3. Conflict (16)        ← 새 기능, 간단
4. Config inherit (13)  ← 강화, 간단
```

**특징**:
- 충돌 0
- 비용 낮음
- 이득 즉시
- pie-lab 전략 유지

---

### **향후 고려 (필요 시)**
```
- web_search 강화 (06)   ← 현재 검색 부족하면
- LSP 강화 (02)          ← coding 기능 평가 후
- Review 강화 (08)       ← nice-to-have
```

---

### **절대 금지**
```
- Hermes와 경합하는 메모리 (11)     🚨
- web-first와 맞지 않는 것들 (12, 07, 01, 18, 03)
```

---

## 💡 추가 개선 (oh-my-pi 외)

pie-lab 자체에서 필요한 것:

1. **Gateway/streaming 안정성** (최근 수정: runner.ts delta streaming)
   - 이미 진행 중 ✅

2. **학습 루프/Hermes** 평가
   - Mnemopi와 통합 가능한가?
   - 아니면 Hermes만 유지?
   - 이것을 먼저 결정해야 메모리 관련 기능 추가 가능

3. **web chat 기능**
   - SSE streaming (이미 있음) ✅
   - 대시보드 통합 (이미 있음) ✅
   - 모바일 최적화 (?)
   - 사용자 관리 (?)

4. **Multi-provider routing 대시보드**
   - 현재 cost tracking 있음
   - provider quota/cooldown 시각화 부족?

---

## 요약

| 카테고리 | 개수 | 상태 | 액션 |
|---------|------|------|------|
| **즉시 적용** | 4개 | 준비됨 | ▶️ 2-3주 내 시작 |
| **선택사항** | 3개 | 이슈 평가 필요 | ⏳ 우선도에 따라 |
| **절대 금지** | 7개 | 제외 | ❌ 진행 X |
| **pie-lab 내부 개선** | 4가지 | 별도 평가 | 📋 Hermes 먼저 |

---

## 최종 결론

**oh-my-pi에서 가져올 것은 소수지만 가치 있다:**
- Hashline (비용 절감)
- GitHub-as-FS (도구 통합)
- Conflict resolver (편의)
- Config inherit (호환성)

**하지만 pie-lab의 기본 전략(웹/chat/learning) 유지가 최우선.**

Hermes learning loop을 먼저 확인한 후, 메모리/확장 기능은 그다음에 결정하자.
