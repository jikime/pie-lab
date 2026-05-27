"use client";

import { Bot, CircleStop, MessageSquarePlus, RefreshCw, Send, UserRound, Wifi, WifiOff } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  API_BASE_URL,
  checkServerHealth,
  fetchSessionHistory,
  listModels,
  streamChatCompletion,
  type OpenAiChatMessage,
  type RouteInfo,
} from "@/lib/chat-api";
import { cn } from "@/lib/utils";

type ChatEntryRole = "user" | "assistant";
type ServerStatus = "checking" | "online" | "offline";

interface ChatEntry {
  id: string;
  role: ChatEntryRole;
  content: string;
  route?: RouteInfo;
  error?: boolean;
}

const QUICK_MODELS = ["auto:chat", "auto:coding", "auto:reasoning"];
const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const LS_CONVERSATION_KEY = "pie_chat_conversation_id";

function getOrCreateConversationId(): string {
  if (typeof window === "undefined") return createId("web");
  const stored = localStorage.getItem(LS_CONVERSATION_KEY);
  if (stored) return stored;
  const id = createId("web");
  localStorage.setItem(LS_CONVERSATION_KEY, id);
  return id;
}

export function ChatApp() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("auto:chat");
  const [conversationId, setConversationId] = useState<string>(() => getOrCreateConversationId());
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  const [models, setModels] = useState<string[]>(QUICK_MODELS);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const routeSummary = useMemo(() => {
    const lastRoute = [...messages].reverse().find((message) => message.route)?.route;
    if (!lastRoute) return "route pending";
    return `${lastRoute.routing_mode ?? "router"} · ${lastRoute.resolved_provider ?? "provider"}`;
  }, [messages]);

  // Load server state (health + models)
  useEffect(() => {
    const controller = new AbortController();

    async function loadServerState() {
      setServerStatus("checking");
      const online = await checkServerHealth(controller.signal);
      setServerStatus(online ? "online" : "offline");
      if (!online) return;

      const nextModels = await listModels(controller.signal);
      if (nextModels.length > 0) {
        setModels(Array.from(new Set([...QUICK_MODELS, ...nextModels])));
      }
    }

    loadServerState();
    return () => controller.abort();
  }, []);

  // Load conversation history from disk on mount (or when conversationId changes)
  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingHistory(true);

    fetchSessionHistory(conversationId, controller.signal).then((history) => {
      if (controller.signal.aborted) return;
      if (history.length > 0) {
        setMessages(
          history.map((msg) => ({
            id: createId(msg.role),
            role: msg.role as "user" | "assistant",
            content: msg.content,
          })),
        );
      }
      setIsLoadingHistory(false);
    });

    return () => controller.abort();
  }, [conversationId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || isSending) return;

    const userMessage: ChatEntry = {
      id: createId("user"),
      role: "user",
      content: prompt,
    };
    const assistantId = createId("assistant");
    const assistantMessage: ChatEntry = {
      id: assistantId,
      role: "assistant",
      content: "",
    };
    const requestMessages = toOpenAiMessages([...messages, userMessage]);
    const controller = new AbortController();

    abortRef.current = controller;
    setInput("");
    setIsSending(true);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      await streamChatCompletion({
        model,
        messages: requestMessages,
        conversationId,
        signal: controller.signal,
        onDelta: (delta) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, content: message.content + delta } : message,
            ),
          );
        },
        onRoute: (route) => {
          setMessages((current) =>
            current.map((message) => (message.id === assistantId ? { ...message, route } : message)),
          );
        },
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                error: !aborted,
                content: aborted ? "요청이 중지되었습니다." : getErrorMessage(error),
              }
            : message,
        ),
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsSending(false);
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  function resetChat() {
    abortRef.current?.abort();
    const newId = createId("web");
    localStorage.setItem(LS_CONVERSATION_KEY, newId);
    setConversationId(newId);
    setMessages([]);
    setInput("");
  }

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-72 shrink-0 border-r bg-card lg:flex lg:flex-col">
        <div className="flex h-[57px] items-center border-b px-4">
          <div className="flex w-full items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold">Pie Chat</h1>
              <p className="mt-1 truncate text-xs text-muted-foreground">{routeSummary}</p>
            </div>
            <Button type="button" variant="outline" size="icon" onClick={resetChat} aria-label="새 대화">
              <MessageSquarePlus />
            </Button>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">서버</span>
              <ServerBadge status={serverStatus} />
            </div>
            <p className="break-all rounded-lg border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
              {API_BASE_URL}
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">빠른 모델</span>
            <div className="flex flex-wrap gap-2">
              {QUICK_MODELS.map((quickModel) => (
                <Button
                  key={quickModel}
                  type="button"
                  size="sm"
                  variant={model === quickModel ? "default" : "outline"}
                  onClick={() => setModel(quickModel)}
                >
                  {quickModel}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-auto border-t px-4 py-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" />
            <span>pie AgentSession</span>
          </div>
        </div>
      </aside>

      <section className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-[57px] items-center border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-semibold lg:hidden">Pie Chat</h1>
                <ServerBadge status={serverStatus} />
              </div>
              <p className="mt-1 hidden truncate text-xs text-muted-foreground sm:block">{API_BASE_URL}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={resetChat}>
              <MessageSquarePlus />
              새 대화
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-5">
            {isLoadingHistory ? (
              <div className="flex flex-1 items-center justify-center py-16">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className="size-4 animate-spin" />
                  <span>이전 대화 불러오는 중…</span>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-16">
                <div className="w-full max-w-xl rounded-lg border bg-card px-5 py-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <Bot className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-lg font-semibold">무엇을 도와드릴까요?</p>
                      <p className="mt-1 text-sm text-muted-foreground">pie session · {model}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} isStreaming={isSending} />
                ))}
              </div>
            ) /* end messages list */}
            <div ref={endRef} />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="border-t bg-card">
          <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="w-full sm:w-72">
                <Input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  list="pie-chat-models"
                  aria-label="모델"
                />
                <datalist id="pie-chat-models">
                  {models.map((modelId) => (
                    <option key={modelId} value={modelId} />
                  ))}
                </datalist>
              </div>
              <div className="flex gap-2 sm:ml-auto">
                {isSending ? (
                  <Button type="button" variant="outline" onClick={stopStreaming}>
                    <CircleStop />
                    중지
                  </Button>
                ) : (
                  <Button type="submit" disabled={!input.trim()}>
                    <Send />
                    전송
                  </Button>
                )}
              </div>
            </div>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="메시지 입력"
              disabled={isSending}
              className="max-h-40 min-h-20"
              aria-label="메시지"
            />
          </div>
        </form>
      </section>
    </main>
  );
}

function MessageBubble({ message, isStreaming }: { message: ChatEntry; isStreaming: boolean }) {
  const isUser = message.role === "user";
  const Icon = isUser ? UserRound : Bot;
  const content = message.content || (isStreaming && !isUser ? "응답 생성 중..." : "");

  return (
    <article className={cn("flex gap-3", isUser && "justify-end")}>
      {!isUser && (
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon className="size-4" />
        </div>
      )}
      <div className={cn("max-w-[min(760px,100%)] space-y-2", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "break-words rounded-lg border px-3 py-2 text-sm leading-6 shadow-sm",
            isUser ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground",
            message.error && "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <MarkdownContent content={content} isUser={isUser} />
        </div>
        {message.route && (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{message.route.routing_mode ?? "router"}</Badge>
            <Badge variant="secondary">{message.route.resolved_provider ?? "provider"}</Badge>
            <Badge variant="secondary">{message.route.resolved_model ?? "model"}</Badge>
          </div>
        )}
      </div>
      {isUser && (
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon className="size-4" />
        </div>
      )}
    </article>
  );
}

function MarkdownContent({ content, isUser }: { content: string; isUser: boolean }) {
  const components = useMemo(() => createMarkdownComponents(isUser), [isUser]);

  return (
    <div className="min-w-0 overflow-hidden">
      <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function createMarkdownComponents(isUser: boolean): Components {
  const linkClass = isUser
    ? "font-medium text-primary-foreground underline underline-offset-2"
    : "font-medium text-primary underline underline-offset-2";
  const inlineCodeClass = isUser
    ? "rounded bg-primary-foreground/15 px-1 py-0.5 font-mono text-[0.85em] text-primary-foreground"
    : "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground";
  const blockCodeClass = isUser ? "font-mono text-xs text-primary-foreground" : "font-mono text-xs text-foreground";
  const quoteClass = isUser
    ? "my-2 border-l-2 border-primary-foreground/40 pl-3 text-primary-foreground/90"
    : "my-2 border-l-2 border-border pl-3 text-muted-foreground";

  return {
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    a: ({ children, href }) => (
      <a className={linkClass} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    h1: ({ children }) => <h1 className="mb-2 mt-1 text-base font-semibold first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
    ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
    li: ({ children }) => <li className="pl-1">{children}</li>,
    blockquote: ({ children }) => <blockquote className={quoteClass}>{children}</blockquote>,
    hr: () => <hr className={cn("my-3 border-t", isUser ? "border-primary-foreground/25" : "border-border")} />,
    pre: ({ children }) => (
      <pre
        className={cn(
          "my-3 max-w-full overflow-x-auto rounded-md border p-3 leading-relaxed",
          isUser ? "border-primary-foreground/20 bg-primary-foreground/10" : "border-border bg-muted/60",
        )}
      >
        {children}
      </pre>
    ),
    code: ({ children, className }) => (
      <code className={cn(className ? blockCodeClass : inlineCodeClass, className)}>{children}</code>
    ),
    table: ({ children }) => (
      <table className="my-3 block max-w-full overflow-x-auto border-collapse text-xs">{children}</table>
    ),
    th: ({ children }) => (
      <th className={cn("border px-2 py-1 text-left font-semibold", isUser ? "border-primary-foreground/25" : "border-border")}>
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className={cn("border px-2 py-1 align-top", isUser ? "border-primary-foreground/25" : "border-border")}>
        {children}
      </td>
    ),
  };
}

function ServerBadge({ status }: { status: ServerStatus }) {
  if (status === "online") {
    return (
      <Badge variant="success">
        <Wifi />
        online
      </Badge>
    );
  }

  if (status === "offline") {
    return (
      <Badge variant="destructive">
        <WifiOff />
        offline
      </Badge>
    );
  }

  return <Badge variant="warning">checking</Badge>;
}

function toOpenAiMessages(messages: ChatEntry[]): OpenAiChatMessage[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
