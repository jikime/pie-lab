export const API_BASE_URL =
  process.env.NEXT_PUBLIC_PIE_API_BASE_URL ?? "http://127.0.0.1:4873";

export type ChatRole = "user" | "assistant" | "system";

export interface OpenAiChatMessage {
  role: ChatRole;
  content: string;
}

export interface RouteInfo {
  requested_model?: string;
  routing_mode?: string;
  resolved_provider?: string;
  resolved_model?: string;
}

export interface StreamChatCompletionOptions {
  model: string;
  messages: OpenAiChatMessage[];
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onRoute?: (route: RouteInfo) => void;
}

interface ModelListResponse {
  data?: Array<{ id?: unknown }>;
}

export async function checkServerHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: "GET",
      signal,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listModels(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/v1/models`, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as ModelListResponse;
  return (body.data ?? [])
    .map((model) => (typeof model.id === "string" ? model.id : undefined))
    .filter((id): id is string => Boolean(id))
    .sort((left, right) => left.localeCompare(right));
}

export async function streamChatCompletion({
  model,
  messages,
  signal,
  onDelta,
  onRoute,
}: StreamChatCompletionOptions): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pie-client-origin": "pie-chat:web",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (!response.body) {
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      onDelta(content);
    }
    if (body?.pi_adk && typeof body.pi_adk === "object") {
      onRoute?.(body.pi_adk as RouteInfo);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      handleSseEvent(event, onDelta, onRoute);
    }
  }

  if (buffer.trim()) {
    handleSseEvent(buffer, onDelta, onRoute);
  }
}

function handleSseEvent(
  event: string,
  onDelta: (delta: string) => void,
  onRoute?: (route: RouteInfo) => void,
): void {
  const dataLines = event
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  for (const data of dataLines) {
    if (!data || data === "[DONE]") {
      continue;
    }

    const payload = JSON.parse(data);
    if (payload?.error?.message) {
      throw new Error(String(payload.error.message));
    }

    if (payload?.pi_adk && typeof payload.pi_adk === "object") {
      onRoute?.(payload.pi_adk as RouteInfo);
    }

    const delta = payload?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") {
      onDelta(delta);
    }
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const message = body?.error?.message ?? body?.message;
    if (typeof message === "string") {
      return message;
    }
  } catch {
    // Fall through to the status text below.
  }

  return `${response.status} ${response.statusText}`.trim();
}
