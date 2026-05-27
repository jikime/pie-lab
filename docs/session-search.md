# Session Search — 대화 이력 검색

작성일: 2026-05-27

이 문서는 `pie session` CLI 명령과 TUI 세션 안에서 사용할 수 있는 `session_search` 에이전트 도구를 설명합니다.

## 개요

pie-lab은 Telegram, Discord, TUI 세션의 대화 내용을 SQLite FTS5 데이터베이스에 인덱싱합니다. 이를 통해 어떤 채널의 대화이든 키워드로 검색하고, 관련 맥락을 다시 찾아볼 수 있습니다.

```
~/.pie/agent/sessions.db   ← FTS5 인덱스 (자동 생성)
~/.pie/agent/sessions/     ← TUI 세션 JSONL
~/.pie/agent/gateway/      ← Gateway reasoning 세션 JSONL
~/.pie/agent/chat/         ← Telegram/Discord 채팅 채널 transcript JSONL
```

## CLI 명령: `pie session`

### 최근 세션 목록

```bash
pie session list
pie session list --source gateway-chat   # Discord/Telegram만
pie session list --source tui            # TUI 세션만
pie session list --limit 50
pie session list --json
```

출력 예시:

```
Source          Name / Channel                      Date        Msgs
──────────────────────────────────────────────────────────────────────
[telegram]      telegram / dm-donghak-kim           2026-05-27    34  donghak: /start
[discord]       discord / channel-14655...          2026-05-27     6  Anthony.Kim: 안녕
[reasoning]     pie gateway / donghak kim           2026-05-27     2  user: - [2026-05-27...]
[tui]           019e61c8-3102-79                    2026-05-26     2  user: hello
```

### 전체 텍스트 검색

```bash
pie session search "hello"
pie session search "안녕"                        # 2자 한국어도 지원
pie session search "배포 이슈" --source tui
pie session search "auth bug" --limit 5
pie session search "코드 리뷰" --json
```

출력 예시:

```
3 result(s) for "hello":

1. [tui] 019e59a1-1a55-79  2026-05-24
   … [hello] …
   Context:
   You  hello
   AI   one
   sessionId: 019e59a1-1a55-7970-8631-698572ea0508
```

### 옵션

| 옵션 | 설명 |
|------|------|
| `--source <type>` | `tui`, `gateway-reasoning`, `gateway-chat` 중 선택 |
| `--limit <n>` | 최대 결과 수 (기본값: 20) |
| `--json` | JSON 형식으로 출력 |

## 에이전트 도구: `session_search`

TUI 세션(`pie tui`) 안에서 AI가 직접 과거 대화를 검색하는 도구입니다. 별도 설정 없이 기본 활성화되어 있습니다.

### 사용 방법

TUI 세션에서 AI에게 자연어로 요청하면 됩니다:

```
"지난주에 배포 이슈를 어떻게 해결했는지 찾아줘"
"Discord에서 안녕이라고 말한 대화를 찾아줘"
"최근 세션 목록을 보여줘"
```

### 파라미터

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `query` | string (선택) | FTS5 검색어. 없으면 최근 세션 목록 반환 |
| `sources` | array (선택) | `["tui"]`, `["gateway-chat"]`, `["gateway-reasoning"]` |
| `limit` | number (선택) | 최대 결과 수 (기본값: 10, 최대: 50) |

### 쿼리 문법

FTS5 고급 연산자를 지원합니다:

```
"exact phrase"     → 정확한 문구 검색
auth AND bug       → 두 단어 모두 포함
deploy OR rollback → 둘 중 하나 포함
deploy*            → 전치사 와일드카드
```

## 내부 구조

### 데이터베이스 스키마

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,         -- 세션 고유 ID
  source TEXT,                 -- tui | gateway-reasoning | gateway-chat
  service TEXT,                -- telegram | discord | web | null
  channel_key TEXT,            -- 채널 식별자
  name TEXT,                   -- 세션 이름 또는 채널 이름
  created_at TEXT,             -- ISO 8601
  modified_at TEXT,            -- ISO 8601
  message_count INTEGER,
  indexed_mtime REAL           -- 마지막 인덱싱 시각
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  session_rowid UNINDEXED,     -- sessions.rowid 참조
  entry_id      UNINDEXED,
  role,                        -- user | assistant
  speaker,                     -- 발화자 이름
  text,                        -- 메시지 내용 (검색 대상)
  timestamp     UNINDEXED,
  tokenize = 'trigram'         -- CJK / 한국어 서브스트링 검색 지원
);
```

### FTS5 trigram 검색의 제약

SQLite FTS5 `trigram` 토크나이저는 3자 이상 검색어에서만 동작합니다. 2자 이하 검색어(예: 한국어 `안녕`)는 자동으로 `LIKE %...%` 폴백으로 처리합니다.

| 검색어 길이 | 처리 방식 |
|-----------|---------|
| 3자 이상 | FTS5 MATCH (빠름, 랭킹 지원) |
| 2자 이하 | LIKE 스캔 (느리지만 정확) |

### Node.js 내장 SQLite `snippet()` 제약

Node.js 22의 내장 `node:sqlite`는 FTS5 보조 함수(`snippet()`, `highlight()`, `bm25()`)를 서브쿼리나 JOIN 컨텍스트에서 지원하지 않습니다. 이 때문에 두 단계 쿼리로 구현됩니다:

1. `messages_fts MATCH` → 매칭 `session_rowid` + `text` 조회
2. `sessions` 테이블 JOIN → 세션 메타데이터 조회
3. JavaScript에서 `makeTextSnippet()` 함수로 하이라이트 생성

### 인덱싱 흐름

```
pie session list / search 실행
  → ensureSessionDBIndexed() 백그라운드 호출
  → db.ingest() — 새로 변경된 JSONL 파일만 증분 인덱싱
  → sessions.db 갱신
```

인덱싱은 파일 mtime을 기반으로 변경된 파일만 처리하므로 반복 실행해도 빠릅니다.

## 관련 파일

| 파일 | 역할 |
|------|------|
| `packages/coding-agent/src/core/session-db.ts` | SQLite FTS5 인덱스, browse/search 구현 |
| `packages/coding-agent/src/core/session-search-tool.ts` | 에이전트 도구 정의 |
| `packages/coding-agent/src/session-cli.ts` | `pie session` CLI 진입점 |
| `packages/coding-agent/src/core/sdk.ts` | `session_search` 초기 활성 도구 등록 |
| `packages/coding-agent/src/main.ts` | `handleSessionCommand` 등록 |

## 버그 수정 이력

| 날짜 | 문제 | 해결 |
|------|------|------|
| 2026-05-27 | FTS5 `snippet()` JOIN 컨텍스트 오류로 검색 결과 0건 | 2단계 쿼리 분리 + JS snippet 생성 |
| 2026-05-27 | 2자 한국어(`안녕`) FTS5 MATCH 실패 | 3자 미만은 LIKE 폴백 자동 적용 |
| 2026-05-27 | TUI 세션에서 `session_search` 도구 미노출 | `sdk.ts` `initialActiveToolNames`에 추가 |
