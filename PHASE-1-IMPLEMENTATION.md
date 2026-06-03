# Phase 1 구현 계획 (2-3주)

## 목표
- Hashline (해시 기반 edit)
- GitHub-as-FS (URI scheme)
- Conflict resolution (conflict:// URL)

---

## 1️⃣ Hashline — 토큰 61% 절감

### 현황 분석

**현재 pie-lab edit 도구** (`packages/coding-agent/src/core/tools/edit.ts`):
```typescript
// 현재 형식
{
  path: "src/file.ts",
  edits: [
    {
      oldText: "const x = 123;",  // ← string match (정확한 문자열)
      newText: "const x = 456;"
    }
  ]
}
```

**문제점**:
- `oldText` 정확하게 매칭해야 함 (공백, 들여쓰기 모두 일치)
- 틀리면 edit 실패 → retry 필요
- 각 retry마다 full response 재생성 → 토큰 낭비

**oh-my-pi Hashline**:
```typescript
// Hashline 형식
{
  path: "src/file.ts",
  edits: [
    {
      anchor: "const x = 123;",
      hash: "abc123def456",  // ← content hash (위치 특정)
      newText: "const x = 456;",
      context: { before: "...", after: "..." }  // 앞뒤 context
    }
  ]
}

// 파일이 변경되었을 때:
// - hash가 틀리면? → anchor를 주변 context로 찾아서 복구
// - 복구 실패? → "stale anchor" 에러 (명확한 피드백)
```

### 구현 단계

#### Step 1: `packages/hashline/` 포트 (1주)
- oh-my-pi의 `/packages/hashline/src/` 분석
- pie-lab에 `/packages/hashline/` 새로 만들기
- 핵심 함수:
  - `computeHash(content): string` — 파일 내용에서 hash 생성
  - `findSnapshot(file, anchor, hash)` — hash 기반 위치 찾기
  - `recoverStaleAnchor(file, anchor, context)` — 오래된 anchor 복구

**의존성**: 없음 (순수 TypeScript)

#### Step 2: Edit 도구 확장 (1주)
위치: `packages/coding-agent/src/core/tools/edit.ts`

**변경사항**:
```typescript
// 현재 schema
const editSchema = {
  path: string,
  edits: { oldText: string, newText: string }[]
}

// 확장 후
const editSchema = {
  path: string,
  edits: { 
    // 기존 (호환성 유지)
    oldText?: string,
    
    // Hashline 추가
    anchor?: string,
    hash?: string,
    context?: { before: string, after: string },
    
    newText: string
  }[]
}
```

**구현**:
1. `edit.ts` import: `import { computeHash, findSnapshot, recoverStaleAnchor } from "@pie-lab/hashline"`
2. execute 함수 수정:
   - `edits[]` 순회 시, hash 있으면 hashline 로직 사용
   - hash 없으면 기존 string-match 로직 사용 (호환성)
3. 에러 처리: "stale anchor" 감지 시 명확한 에러 메시지

**테스트**:
- 기존 edit 형식 (oldText만) → 여전히 동작해야 함
- Hashline 형식 (anchor + hash) → 토큰 절감 검증

#### Step 3: Agent에 Hashline 추가 (선택)
위치: `packages/coding-agent/src/sdk.ts` (또는 agent-loop)

**목표**: Agent가 edit 호출 시 자동으로 hash 생성하게 함

**구현**:
```typescript
// agent가 edit 생성할 때
const editCall = {
  path: "src/file.ts",
  edits: [
    {
      oldText: "const x = 123;",
      newText: "const x = 456;"
    }
  ]
}

// tool execute 시 자동으로 hash 추가
const withHash = {
  anchor: editCall.edits[0].oldText,
  hash: computeHash(fileContent),  // 자동 생성
  context: { before: "...", after: "..." },
  newText: editCall.edits[0].newText
}
```

**우선도**: 낮음 (Agent가 hash를 생성할 필요는 없음, tool이 처리해도 됨)

---

### 비용-효과

| 항목 | 수치 |
|------|------|
| 구현 시간 | 2주 |
| 위험도 | 낮음 (새 라이브러리 + 기존 호환성 유지) |
| 토큰 절감 | 61% (벤치마크 증명) |
| 월 비용 절감 | $1,500~2,000 |

---

## 2️⃣ GitHub-as-FS — prompt 절감

### 현황 분석

**현재 pie-lab**:
```typescript
// 3개의 다른 도구/방식
const result1 = read("src/file.ts");  // 로컬 파일
const result2 = gh("pr view", "1428");  // GitHub PR
const result3 = search("...");  // 콘텐츠 검색

// Agent가 배워야 할 것: 3가지 인터페이스
```

**oh-my-pi**:
```typescript
// 1개의 도구로 모두 처리
const result1 = read("src/file.ts");      // 로컬 파일
const result2 = read("pr://owner/repo/1428");  // GitHub PR
const result3 = search("in:pr://1428");   // PR 내에서 검색

// Agent가 배워야 할 것: 1가지 인터페이스 + URI scheme
```

### 구현 단계

#### Step 1: Internal URI resolver 구현 (1주)
위치: `packages/coding-agent/src/core/internal-urls/`

**핵심 함수**:
```typescript
interface URIResolver {
  canHandle(uri: string): boolean;  // "pr://" 인식?
  resolve(uri: string): Promise<{ path: string, content: string }>;
}

// 구현:
class GitHubURIResolver implements URIResolver {
  canHandle(uri: string) { return uri.startsWith("pr://"); }
  async resolve(uri: string) {
    const [, owner, repo, prNumber] = uri.match(/pr:\/\/([^/]+)\/([^/]+)\/(\d+)/);
    const pr = await gh("pr view", `${owner}/${repo}/${prNumber}`);
    return { path: uri, content: pr.data };
  }
}

// 유사하게:
class IssueURIResolver { ... }  // issue://
class AgentURIResolver { ... }  // agent:// (subagent 결과)
```

#### Step 2: Read/Search 도구에 통합 (1주)
위치: `packages/coding-agent/src/core/tools/read.ts`, `search.ts`

**변경**:
```typescript
// read 도구
async execute(params) {
  const path = params.path;
  
  // URI인가?
  if (path.includes("://")) {
    const resolver = resolvers.find(r => r.canHandle(path));
    if (resolver) {
      return resolver.resolve(path);
    }
  }
  
  // 아니면 로컬 파일
  return readLocalFile(path);
}

// search 도구
async execute(params) {
  let searchSpace = params.path || ".";
  let content = undefined;
  
  // "search in:pr://1428" 형식
  if (searchSpace.includes("in:")) {
    const uriPart = searchSpace.split("in:")[1];
    const resolver = resolvers.find(r => r.canHandle(uriPart));
    content = await resolver.resolve(uriPart);
  }
  
  // 기존 로직
  return searchInContent(params.query, content);
}
```

#### Step 3: 테스트
```typescript
// test: GitHub URI 해석
await read("pr://anthropic/claude-code/1428");
// 결과: PR #1428의 description + files

// test: 조합 사용
await search("interface", "in:pr://anthropic/claude-code/1428");
// 결과: PR 내에서 "interface" 검색

// test: agent 결과 접근
await read("agent://subagent-1/findings.0.title");
// 결과: subagent의 첫 finding 제목
```

---

### 비용-효과

| 항목 | 수치 |
|------|------|
| 구현 시간 | 2주 |
| 위험도 | 중간 (read/search 도구 수정, 하지만 URI 앞에만 조건) |
| prompt 절감 | ~11KB per turn |
| 월 비용 절감 | ~$1,500 (prompt token 절감) |

---

## 3️⃣ Conflict resolution — merge 자동화

### 현황 분석

**현재 상황**:
- Git merge conflict 발생 → agent가 수동으로 마커 처리
- `<<<<<<<` / `=======` / `>>>>>>>` 마커를 agent가 이해해야 함
- 복잡하고 오류 가능

**oh-my-pi**:
- Conflict 자동 감지 → `conflict://1`, `conflict://2` ID 부여
- Agent: `write conflict://1 @theirs` (간단함)
- 자동으로 resolve됨

### 구현 단계

#### Step 1: Conflict 감지 라이브러리 (1주)
위치: `packages/coding-agent/src/core/tools/conflict-detect.ts`

oh-my-pi의 `/packages/coding-agent/src/tools/conflict-detect.ts` 포트

**핵심**:
```typescript
export interface ConflictBlock {
  startLine: number;      // <<<<<<<
  separatorLine: number;  // =======
  endLine: number;        // >>>>>>>
  oursLines: string[];
  theirsLines: string[];
  oursLabel?: string;     // HEAD 대신 custom label
}

export function scanConflictLines(lines: string[], firstLineNumber: number): ConflictBlock[]
export function resolveConflict(file: string, conflictId: number, choice: "ours" | "theirs" | "base"): string
```

#### Step 2: Read/Write 도구 통합 (1주)
위치: `packages/coding-agent/src/core/tools/read.ts`, `write.ts`

**Read에서**:
```typescript
async execute(params) {
  const lines = readFile(path);
  const conflicts = scanConflictLines(lines, 1);
  
  if (conflicts.length > 0) {
    // footer에 conflict 정보 추가
    const conflictInfo = conflicts
      .map((c, i) => `conflict://${i+1} : lines ${c.startLine}-${c.endLine}`)
      .join("\n");
    
    return {
      content: lines.join("\n"),
      footer: `⚠ ${conflicts.length} conflict(s) detected:\n${conflictInfo}\n\nResolve with: write conflict://N @theirs|@ours|@base`
    };
  }
  
  return { content: lines.join("\n") };
}
```

**Write에서**:
```typescript
async execute(params) {
  const path = params.path;
  const content = params.content;
  
  // conflict:// URL인가?
  if (path.startsWith("conflict://")) {
    const match = path.match(/conflict:\/\/(\d+)/);
    if (match) {
      const conflictId = parseInt(match[1]);
      const choice = content; // "@theirs", "@ours", "@base"
      
      const fileLines = readFile(originalPath);
      const resolved = resolveConflict(fileLines, conflictId, choice);
      
      writeFile(originalPath, resolved);
      return { success: true, message: `Resolved conflict #${conflictId}` };
    }
  }
  
  // 일반 write
  return writeFile(path, content);
}
```

#### Step 3: 세션 상태 관리 (선택)
- ConflictHistory를 session에 저장
- 파일이 변경되면 conflict ID 재할당

**우선도**: 낮음 (구현의 편의사항)

---

### 비용-효과

| 항목 | 수치 |
|------|------|
| 구현 시간 | 1-2주 |
| 위험도 | 낮음 (read/write에 조건 추가) |
| 가치 | workflow 자동화 (정성적) |

---

## 📊 Phase 1 타임라인

```
Week 1:
  - Hashline 구현 (packages/hashline/)
  - Hashline 테스트

Week 2:
  - Edit 도구에 Hashline 통합
  - GitHub-as-FS (URI resolver)
  - Conflict-detect 라이브러리

Week 3:
  - Read/Search에 URI scheme 통합
  - Read/Write에 conflict:// 통합
  - 통합 테스트

결과:
  - ✅ Hashline (토큰 61% 절감)
  - ✅ GitHub-as-FS (prompt 절감)
  - ✅ Conflict resolution (merge 자동화)
```

---

## ✅ 성공 기준

### Hashline
- [ ] string-match edit는 여전히 동작 (호환성)
- [ ] hash-based edit 동작
- [ ] stale anchor 감지 및 복구
- [ ] 토큰 사용량 61% 감소 검증

### GitHub-as-FS
- [ ] `read pr://owner/repo/1428` 동작
- [ ] `read issue://owner/repo/456` 동작
- [ ] `search keyword in:pr://1428` 동작
- [ ] prompt token 절감 측정

### Conflict resolution
- [ ] `read` 시 conflict 감지 & 목록 표시
- [ ] `write conflict://1 @theirs` 동작
- [ ] 자동으로 conflict 해결

---

## 🚀 다음 단계 (Phase 2)

Phase 1 완료 후:
- web_search 14-provider 확장
- Code review 강화
- LSP wired 통합

---

## 📝 주의사항

1. **호환성 유지**: 기존 edit 형식 (oldText) 계속 지원
2. **점진적 마이그레이션**: Agent가 hash를 강요하지 않음 (필요시만)
3. **테스트**: 각 단계마다 기존 기능 회귀 테스트
4. **에러 처리**: stale anchor, URI 해석 실패 등 명확한 메시지
