// design-api.ts — 서버 API 클라이언트 (4절 계약만 의존)
// SSE 소비는 apps/chat/src/lib/chat-api.ts의 fetch()+getReader()+버퍼 분리
// 패턴을 그대로 따른다(native EventSource 아님 — 02-architecture 3절 결정).

import type {
  DesignOptionsResponse,
  DesignRunRequest,
  DesignRunStatusResponse,
  DesignStreamEvent,
} from "@/lib/design-protocol";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_PIE_API_BASE_URL ?? "http://127.0.0.1:4873";

const CLIENT_ORIGIN_HEADER = "pie-design:web";

export async function fetchDesignOptions(
  signal?: AbortSignal,
): Promise<DesignOptionsResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/design/options`, {
    method: "GET",
    headers: { "x-pie-client-origin": CLIENT_ORIGIN_HEADER },
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as DesignOptionsResponse;
}

export async function fetchRunStatus(
  runId: string,
  signal?: AbortSignal,
): Promise<DesignRunStatusResponse> {
  const response = await fetch(
    `${API_BASE_URL}/v1/design/runs/${encodeURIComponent(runId)}`,
    {
      method: "GET",
      headers: { "x-pie-client-origin": CLIENT_ORIGIN_HEADER },
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as DesignRunStatusResponse;
}

// raw HTML 서빙 경로(미리보기 fetch / 다운로드 링크에 사용).
export function artifactUrl(
  runId: string,
  name: string,
  download = false,
): string {
  const base = `${API_BASE_URL}/v1/design/runs/${encodeURIComponent(
    runId,
  )}/artifact/${encodeURIComponent(name)}`;
  return download ? `${base}?download=1` : base;
}

// ArtifactDescriptor.url은 서버가 절대/상대 어느 쪽으로 줄 수 있으므로
// API_BASE_URL 기준으로 정규화한다.
export function resolveArtifactUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${API_BASE_URL}${path}`;
}

export interface StreamDesignRunOptions {
  request: DesignRunRequest;
  signal?: AbortSignal;
  onEvent: (event: DesignStreamEvent) => void;
}

// POST /v1/design/runs — 런 생성 + 즉시 SSE 스트림 소비.
export async function streamDesignRun({
  request,
  signal,
  onEvent,
}: StreamDesignRunOptions): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/design/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pie-client-origin": CLIENT_ORIGIN_HEADER,
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await readErrorMessage(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      handleSseChunk(chunk, onEvent);
    }
  }

  if (buffer.trim()) {
    handleSseChunk(buffer, onEvent);
  }
}

function handleSseChunk(
  chunk: string,
  onEvent: (event: DesignStreamEvent) => void,
): void {
  const dataLines = chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  for (const data of dataLines) {
    if (!data || data === "[DONE]") {
      continue;
    }

    const payload = JSON.parse(data) as DesignStreamEvent;
    onEvent(payload);
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message = body?.error?.message ?? body?.message;
    if (typeof message === "string") {
      return message;
    }
  } catch {
    // Fall through to the status text below.
  }

  return `${response.status} ${response.statusText}`.trim();
}
