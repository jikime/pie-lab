// ─────────────────────────────────────────────────────────────────────────
// design-protocol.ts — 공유 타입 정본 (single source of truth)
//
// 02-architecture.md 4절 API 계약과 1:1 미러다. 서버(apps/server/src/
// design-runs-api.ts)는 이 파일을 import하지 않고 동일 구조의 타입을 자체
// 선언한다(서버↔웹 빌드 결합 방지). 이 파일이 바뀌면 아키텍트가 양쪽에
// 동시 통지한다. — 웹 구현자가 이 파일을 단독 변경하지 않는다.
// ─────────────────────────────────────────────────────────────────────────

// ── 선택지 ───────────────────────────────────────────────
export interface DesignSkillOption {
  id: string; // "single-page-html"
  title: string; // "Single-page HTML"
  description: string;
}

export interface DesignSystemOption {
  id: string; // "minimal"
  title: string; // "Minimal"
}

export interface DesignOptionsResponse {
  skills: DesignSkillOption[];
  designSystems: DesignSystemOption[];
  defaultSkillId: string;
}

// ── 런 생성 요청 ─────────────────────────────────────────
export interface DesignRunRequest {
  prompt: string; // brief (필수, 비어있으면 400)
  skillId: string; // primary 디자인 스킬 (필수)
  designSystemId: string | null; // null = 지정 안 함
  model?: string; // 미지정 시 서버 기본 "auto:chat"
  conversationId?: string; // 미지정 시 서버가 design_<uuid> 생성
}

// ── SSE 이벤트 유니온 (스트림 본문) ──────────────────────
// 전송: `data: <json-of-DesignStreamEvent>\n\n`, 종료는 `data: [DONE]\n\n`
export type DesignStreamEvent =
  | DesignStartEvent
  | DesignProgressEvent
  | DesignTextEvent
  | DesignArtifactEvent
  | DesignDoneEvent
  | DesignErrorEvent;

export interface DesignStartEvent {
  type: "start";
  runId: string;
  conversationId: string;
  model: string; // 해석된 provider/model 또는 요청 model
}

// 진행 상태(에이전트 라이프사이클/툴 시작 등 비텍스트 신호)
export interface DesignProgressEvent {
  type: "progress";
  phase: "queued" | "running" | "tool_start" | "tool_end";
  label: string; // 사람이 읽을 라벨 (예: "writing index.html")
  toolName?: string; // phase가 tool_*일 때
}

// 어시스턴트 텍스트 델타(설명/사고 요약 표시용)
export interface DesignTextEvent {
  type: "text";
  delta: string;
}

// ⭐ 아티팩트 이벤트 — write 툴 신호에서 서버가 합성
export interface DesignArtifactEvent {
  type: "artifact";
  artifact: ArtifactDescriptor;
}

export interface ArtifactDescriptor {
  name: string; // 파일명, 예: "index.html"
  kind: "html"; // MVP 고정
  status: "streaming" | "complete";
  // status==="complete"일 때만 채워짐. 미리보기는 url을 fetch하거나 inlineHtml 사용.
  url?: string; // raw 서빙 경로: /v1/design/runs/<runId>/artifact/<name>
  inlineHtml?: string; // 선택: complete 시 전체 HTML 인라인 동봉(미리보기 즉시화)
  bytes?: number;
}

export interface DesignDoneEvent {
  type: "done";
  status: "succeeded" | "failed" | "aborted";
  artifacts: ArtifactDescriptor[]; // 이번 런이 만든 최종 아티팩트 목록(전부 complete)
}

export interface DesignErrorEvent {
  type: "error";
  message: string;
}

// ── 런 상태 조회 응답 (4.3 GET /v1/design/runs/:id) ──────
export type DesignRunStatus = "running" | "succeeded" | "failed" | "aborted";

export interface DesignRunStatusResponse {
  runId: string;
  status: DesignRunStatus;
  artifacts: ArtifactDescriptor[];
}
