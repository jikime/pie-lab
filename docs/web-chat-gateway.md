# Web Chat Gateway 채널

작성일: 2026-05-27

이 문서는 웹 채팅(`apps/chat`)을 Telegram/Discord와 동일한 gateway 채널로 운영하는 방식을 설명합니다. 선택적 연결(optional IPC) 구조를 채택해, gateway가 실행 중이면 gateway를 통해 라우팅하고 아니면 독립 세션으로 폴백합니다.

## 배경

기존 웹 채팅은 매 요청마다 독립 `AgentSession`을 생성했습니다. 이 방식은 다음 문제가 있었습니다:

- Telegram/Discord 대화를 웹에서 볼 수 없음 (플랫폼 고립)
- 대화 내역이 메모리에만 있고 새로고침 시 사라짐
- 동일 에이전트가 여러 채널에서 별도 컨텍스트로 실행

새 구조는 웹 채팅도 gateway의 `GatewayConversationWorker`에 연결해 단일 에이전트 프로세스가 Telegram, Discord, Web을 모두 처리합니다.

## 아키텍처

```
apps/chat (Next.js)
  │
  │  POST /v1/pie/chat/message
  │  GET  /v1/pie/chat/sessions?conversation_id=...
  ▼
apps/server/src/pie-agent-chat-api.ts
  │
  ├─ WebIPCClient.probe() ──────────────────────────────────┐
  │   (300ms timeout)                                        │
  │   ├─ gateway 실행 중 → IPC 라우팅                        │
  │   └─ gateway 없음   → 독립 AgentSession 폴백            │
  │                                                          ▼
  │                                              ~/.pie/agent/gateway-web.sock
  │                                                          │
  │                                              WebIPCServer (gateway daemon)
  │                                                          │
  │                                              GatewayConversationWorker
  │                                              (web 전용, conversationId별)
  │
  └─ 독립 폴백
      ~/.pie/agent/sessions/web-chat/{conversationId}/
      SessionManager.continueRecent()
```

## Unix Socket IPC 프로토콜

소켓 경로: `~/.pie/agent/gateway-web.sock`

### 클라이언트 → 서버

```jsonc
// 메시지 전송
{ "type": "chat", "conversationId": "web_xxx", "text": "Hello", "userId": "web-user", "model": "claude-opus-4-7" }

// 응답 중단
{ "type": "abort", "conversationId": "web_xxx" }

// 연결 확인
{ "type": "ping" }
```

### 서버 → 클라이언트

```jsonc
// 연결 확인
{ "type": "pong" }

// 입력 중 표시
{ "type": "typing", "active": true }

// 스트리밍 토큰
{ "type": "delta", "text": "Hi" }

// 완료
{ "type": "done", "text": "전체 응답" }

// 오류
{ "type": "error", "message": "..." }
```

## 대화 영속성 (새로고침 복원)

### 프론트엔드 (`apps/chat`)

```typescript
// localStorage에 conversationId 저장
const LS_CONVERSATION_KEY = "pie_chat_conversation_id";

function getOrCreateConversationId(): string {
    const saved = localStorage.getItem(LS_CONVERSATION_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(LS_CONVERSATION_KEY, id);
    return id;
}
```

페이지 로드 시 `GET /v1/pie/chat/sessions?conversation_id=...`로 이전 메시지를 로드해 화면에 복원합니다.

### 백엔드 (`apps/server`)

```
대화 저장 경로:
~/.pie/agent/chat/accounts/web/channels/{conversationId}/channel.jsonl
~/.pie/agent/sessions/web-chat/{conversationId}/*.jsonl  (독립 모드)
```

이력 조회 시 디렉토리의 JSONL 파일을 읽어 `message_update` 엔트리를 파싱해 반환합니다.

## 세션 격리 (service: "web")

Gateway 세션 키는 `{service}/{channelKey}` 형태입니다. 웹 채팅은 `service: "web"`으로 등록됩니다:

```
web/conv-uuid-xxxx    ← 웹 채팅 세션
telegram/dm-username  ← Telegram DM 세션
discord/channel-id    ← Discord 채널 세션
```

따라서 플랫폼별 대화가 서로 격리되면서도 같은 gateway worker pool에서 관리됩니다.

## 관련 파일

| 파일 | 역할 |
|------|------|
| `packages/coding-agent/src/core/gateway/web-ipc-server.ts` | Unix socket 서버, gateway 측 |
| `packages/coding-agent/src/core/gateway/web-ipc-client.ts` | Unix socket 클라이언트, API 서버 측 |
| `packages/coding-agent/src/core/gateway/runner.ts` | gateway 시작 시 WebIPCServer 초기화 |
| `apps/server/src/pie-agent-chat-api.ts` | IPC probe → 라우팅/폴백, 이력 조회 |
| `apps/chat/src/lib/chat-api.ts` | `fetchSessionHistory()` 함수 |
| `apps/chat/src/components/chat/chat-app.tsx` | conversationId 관리, 이력 복원 UI |

## 설계 결정 사항

### 선택적 연결 (Optional IPC)

gateway가 항상 실행된다는 가정을 하지 않습니다. `probe()` 결과에 따라 자동으로 전환합니다:

| 상황 | 동작 |
|------|------|
| gateway 실행 중 | IPC를 통해 gateway worker로 라우팅 |
| gateway 없음 | 독립 `AgentSession` 생성 (기존 방식) |

### Factory Callback으로 순환 의존 차단

`web-ipc-server.ts`가 `runner.ts`를 import하면 순환 의존이 발생합니다. 이를 `createWorker` 콜백 주입으로 해결합니다:

```typescript
// runner.ts
const webIpc = new WebIPCServer({
    agentDir,
    createWorker: async (conversationId) => {
        // runner.ts 내부에서 worker 생성, web-ipc-server.ts는 이를 모름
        const conversation = buildWebConversation(agentDir, conversationId);
        const worker = new GatewayConversationWorker({ ... });
        await worker.start();
        return worker;
    },
});
```

### TypeScript `erasableSyntaxOnly` 호환

프로젝트의 `tsconfig.build.json`에 `erasableSyntaxOnly: true`가 설정되어 있어 파라미터 프로퍼티(`constructor(private x)`)가 금지됩니다. `WebIPCServer`, `WebIPCTransport` 클래스는 필드를 명시적으로 선언합니다:

```typescript
// 금지 (TS1294 오류)
class WebIPCServer {
    constructor(private opts: WebIPCServerOpts) {}
}

// 허용 (명시적 필드 선언)
class WebIPCServer {
    private opts: WebIPCServerOpts;
    constructor(opts: WebIPCServerOpts) {
        this.opts = opts;
    }
}
```

## 버그 수정 이력

| 날짜 | 문제 | 해결 |
|------|------|------|
| 2026-05-27 | `new SessionManager()` private constructor 오류 | `SessionManager.create()` 팩토리 메서드로 변경 |
| 2026-05-27 | `AgentSessionEvent` 타입 불일치 (`stopReason`) | `"end_turn"` → `"stop"` |
| 2026-05-27 | `message_update` 필수 `message` 필드 누락 | `makeAssistantMsg()` 헬퍼 추가 |
| 2026-05-27 | `GatewayConversationWorker` 순환 import | factory callback 패턴으로 분리 |
| 2026-05-27 | `erasableSyntaxOnly` TS1294 오류 | 파라미터 프로퍼티 → 명시적 필드 선언 |
