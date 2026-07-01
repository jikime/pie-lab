(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/apps/design/src/lib/design-api.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// design-api.ts — 서버 API 클라이언트 (4절 계약만 의존)
// SSE 소비는 apps/chat/src/lib/chat-api.ts의 fetch()+getReader()+버퍼 분리
// 패턴을 그대로 따른다(native EventSource 아님 — 02-architecture 3절 결정).
__turbopack_context__.s([
    "API_BASE_URL",
    ()=>API_BASE_URL,
    "artifactUrl",
    ()=>artifactUrl,
    "fetchDesignOptions",
    ()=>fetchDesignOptions,
    "fetchRunStatus",
    ()=>fetchRunStatus,
    "resolveArtifactUrl",
    ()=>resolveArtifactUrl,
    "streamDesignRun",
    ()=>streamDesignRun
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
const API_BASE_URL = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].env.NEXT_PUBLIC_PIE_API_BASE_URL ?? "http://127.0.0.1:4873";
const CLIENT_ORIGIN_HEADER = "pie-design:web";
async function fetchDesignOptions(signal) {
    const response = await fetch(`${API_BASE_URL}/v1/design/options`, {
        method: "GET",
        headers: {
            "x-pie-client-origin": CLIENT_ORIGIN_HEADER
        },
        signal
    });
    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }
    return await response.json();
}
async function fetchRunStatus(runId, signal) {
    const response = await fetch(`${API_BASE_URL}/v1/design/runs/${encodeURIComponent(runId)}`, {
        method: "GET",
        headers: {
            "x-pie-client-origin": CLIENT_ORIGIN_HEADER
        },
        signal
    });
    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }
    return await response.json();
}
function artifactUrl(runId, name, download = false) {
    const base = `${API_BASE_URL}/v1/design/runs/${encodeURIComponent(runId)}/artifact/${encodeURIComponent(name)}`;
    return download ? `${base}?download=1` : base;
}
function resolveArtifactUrl(url) {
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${API_BASE_URL}${path}`;
}
async function streamDesignRun({ request, signal, onEvent }) {
    const response = await fetch(`${API_BASE_URL}/v1/design/runs`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-pie-client-origin": CLIENT_ORIGIN_HEADER
        },
        body: JSON.stringify(request),
        signal
    });
    if (!response.ok || !response.body) {
        throw new Error(await readErrorMessage(response));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while(true){
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {
            stream: true
        });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks){
            handleSseChunk(chunk, onEvent);
        }
    }
    if (buffer.trim()) {
        handleSseChunk(buffer, onEvent);
    }
}
function handleSseChunk(chunk, onEvent) {
    const dataLines = chunk.split("\n").map((line)=>line.trim()).filter((line)=>line.startsWith("data:")).map((line)=>line.slice(5).trim());
    for (const data of dataLines){
        if (!data || data === "[DONE]") {
            continue;
        }
        const payload = JSON.parse(data);
        onEvent(payload);
    }
}
async function readErrorMessage(response) {
    try {
        const body = await response.json();
        const message = body?.error?.message ?? body?.message;
        if (typeof message === "string") {
            return message;
        }
    } catch  {
    // Fall through to the status text below.
    }
    return `${response.status} ${response.statusText}`.trim();
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/design/src/lib/srcdoc.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// srcdoc.ts — open-design runtime/srcdoc.ts buildSrcdoc()의 최소 추출.
// MVP는 단일 self-contained HTML 문서(외부 자산 인라인/CDN)이므로 baseHref
// 주입이나 edit-mode 브리지는 제외한다(02-architecture 1절 매핑).
//
// 에이전트가 완성된 <!doctype html> 전체 문서를 쓰도록 시스템 프롬프트에서
// 강제하므로, 받은 HTML을 그대로 iframe srcDoc에 넣는 것으로 충분하다.
// 다만 매우 드물게 부분 HTML이 오면 최소 문서로 감싼다.
__turbopack_context__.s([
    "buildSrcdoc",
    ()=>buildSrcdoc
]);
function buildSrcdoc(html) {
    const trimmed = html.trimStart();
    const looksLikeDocument = /^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
    if (looksLikeDocument) {
        return html;
    }
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
${html}
</body>
</html>`;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/design/src/lib/utils.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "cn",
    ()=>cn
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/clsx/dist/clsx.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/tailwind-merge/dist/bundle-mjs.mjs [app-client] (ecmascript)");
;
;
function cn(...inputs) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["twMerge"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["clsx"])(inputs));
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/design/src/components/ArtifactPreview.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ArtifactPreview",
    ()=>ArtifactPreview
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$download$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Download$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/download.mjs [app-client] (ecmascript) <export default as Download>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$external$2d$link$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ExternalLink$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/external-link.mjs [app-client] (ecmascript) <export default as ExternalLink>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/loader-circle.mjs [app-client] (ecmascript) <export default as Loader2>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$design$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/lib/design-api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$srcdoc$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/lib/srcdoc.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/lib/utils.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
function ArtifactPreview({ runId, artifact }) {
    _s();
    const [fetchedHtml, setFetchedHtml] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [fetchError, setFetchError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const inlineHtml = artifact?.inlineHtml ?? null;
    const url = artifact?.url ?? null;
    const isComplete = artifact?.status === "complete";
    // inlineHtml이 없고 url만 있을 때 raw HTML을 fetch한다.
    // effect 본문에서 동기 setState를 피하기 위해(react-hooks/set-state-in-effect)
    // 모든 상태 갱신을 async 콜백 안에서 수행한다.
    const shouldFetch = Boolean(artifact && isComplete && !inlineHtml && url);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "ArtifactPreview.useEffect": ()=>{
            const controller = new AbortController();
            void ({
                "ArtifactPreview.useEffect": async ()=>{
                    if (!shouldFetch || !url) {
                        setFetchError(null);
                        setFetchedHtml(null);
                        return;
                    }
                    setFetchError(null);
                    setFetchedHtml(null);
                    setLoading(true);
                    try {
                        const response = await fetch((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$design$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveArtifactUrl"])(url), {
                            signal: controller.signal
                        });
                        if (!response.ok) {
                            throw new Error(`${response.status} ${response.statusText}`.trim());
                        }
                        setFetchedHtml(await response.text());
                    } catch (error) {
                        if (controller.signal.aborted) return;
                        setFetchError(error instanceof Error ? error.message : "미리보기 로드 실패");
                    } finally{
                        if (!controller.signal.aborted) setLoading(false);
                    }
                }
            })["ArtifactPreview.useEffect"]();
            return ({
                "ArtifactPreview.useEffect": ()=>controller.abort()
            })["ArtifactPreview.useEffect"];
        }
    }["ArtifactPreview.useEffect"], [
        shouldFetch,
        url
    ]);
    const html = inlineHtml ?? fetchedHtml;
    const downloadHref = runId && artifact ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$design$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["artifactUrl"])(runId, artifact.name, true) : null;
    const openHref = runId && artifact ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$design$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["artifactUrl"])(runId, artifact.name, false) : null;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex h-full min-h-0 flex-col rounded-xl border border-border bg-card shadow-sm",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center justify-between gap-2 border-b border-border px-4 py-2.5",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex min-w-0 items-center gap-2",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "truncate text-sm font-medium text-foreground",
                                children: artifact ? artifact.name : "미리보기"
                            }, void 0, false, {
                                fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                                lineNumber: 74,
                                columnNumber: 11
                            }, this),
                            artifact?.status === "streaming" ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                                        className: "size-3 animate-spin"
                                    }, void 0, false, {
                                        fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                                        lineNumber: 79,
                                        columnNumber: 15
                                    }, this),
                                    "생성 중"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                                lineNumber: 78,
                                columnNumber: 13
                            }, this) : null,
                            typeof artifact?.bytes === "number" ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "text-xs text-muted-foreground",
                                children: formatBytes(artifact.bytes)
                            }, void 0, false, {
                                fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                                lineNumber: 84,
                                columnNumber: 13
                            }, this) : null
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                        lineNumber: 73,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-1.5",
                        children: [
                            openHref ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                                href: openHref,
                                target: "_blank",
                                rel: "noreferrer",
                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs", "hover:bg-muted"),
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$external$2d$link$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ExternalLink$3e$__["ExternalLink"], {
                                        className: "size-3.5"
                                    }, void 0, false, {
                                        fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                                        lineNumber: 100,
                                        columnNumber: 15
                                    }, this),
                                    "새 탭"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                                lineNumber: 91,
                                columnNumber: 13
                            }, this) : null,
                            downloadHref ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                                href: downloadHref,
                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", "bg-primary text-primary-foreground hover:opacity-90"),
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$download$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Download$3e$__["Download"], {
                                        className: "size-3.5"
                                    }, void 0, false, {
                                        fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                                        lineNumber: 112,
                                        columnNumber: 15
                                    }, this),
                                    "다운로드"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                                lineNumber: 105,
                                columnNumber: 13
                            }, this) : null
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                        lineNumber: 89,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                lineNumber: 72,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "relative min-h-0 flex-1 overflow-hidden rounded-b-xl bg-white",
                children: renderBody({
                    artifact,
                    html,
                    loading,
                    fetchError
                })
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                lineNumber: 119,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
        lineNumber: 71,
        columnNumber: 5
    }, this);
}
_s(ArtifactPreview, "3jWalLWWP9wGJgW9r8uFaEP8LHM=");
_c = ArtifactPreview;
function renderBody({ artifact, html, loading, fetchError }) {
    if (!artifact) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground",
            children: "실행하면 단일 페이지 HTML 아티팩트가 여기에 미리보기됩니다."
        }, void 0, false, {
            fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
            lineNumber: 141,
            columnNumber: 7
        }, this);
    }
    if (fetchError) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "flex h-full items-center justify-center p-6 text-center text-sm text-destructive",
            children: [
                "미리보기 로드 실패: ",
                fetchError
            ]
        }, void 0, true, {
            fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
            lineNumber: 149,
            columnNumber: 7
        }, this);
    }
    if (html) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("iframe", {
            title: `artifact-${artifact.name}`,
            className: "size-full border-0",
            sandbox: "allow-scripts allow-downloads",
            srcDoc: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$srcdoc$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["buildSrcdoc"])(html)
        }, void 0, false, {
            fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
            lineNumber: 157,
            columnNumber: 7
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                className: "size-4 animate-spin"
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
                lineNumber: 168,
                columnNumber: 7
            }, this),
            loading ? "미리보기 불러오는 중…" : "아티팩트 생성 중…"
        ]
    }, void 0, true, {
        fileName: "[project]/apps/design/src/components/ArtifactPreview.tsx",
        lineNumber: 167,
        columnNumber: 5
    }, this);
}
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
var _c;
__turbopack_context__.k.register(_c, "ArtifactPreview");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/design/src/components/DesignSystemPicker.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DesignSystemPicker",
    ()=>DesignSystemPicker
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/lib/utils.ts [app-client] (ecmascript)");
"use client";
;
;
// designSystemId === null = 지정 안 함(계약 4.0). select에서는 빈 문자열로 표현.
const NONE_VALUE = "";
function DesignSystemPicker({ designSystems, value, onChange, disabled }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
        className: "flex flex-col gap-1.5",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-sm font-medium text-foreground",
                children: "디자인 시스템"
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/DesignSystemPicker.tsx",
                lineNumber: 24,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("select", {
                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("h-10 rounded-md border border-input bg-card px-3 text-sm", "focus:outline-none focus:ring-2 focus:ring-ring", disabled && "cursor-not-allowed opacity-60"),
                value: value ?? NONE_VALUE,
                disabled: disabled,
                onChange: (event)=>{
                    const next = event.target.value;
                    onChange(next === NONE_VALUE ? null : next);
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                        value: NONE_VALUE,
                        children: "지정 안 함"
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/DesignSystemPicker.tsx",
                        lineNumber: 38,
                        columnNumber: 9
                    }, this),
                    designSystems.map((option)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                            value: option.id,
                            children: option.title
                        }, option.id, false, {
                            fileName: "[project]/apps/design/src/components/DesignSystemPicker.tsx",
                            lineNumber: 40,
                            columnNumber: 11
                        }, this))
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/components/DesignSystemPicker.tsx",
                lineNumber: 25,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/design/src/components/DesignSystemPicker.tsx",
        lineNumber: 23,
        columnNumber: 5
    }, this);
}
_c = DesignSystemPicker;
var _c;
__turbopack_context__.k.register(_c, "DesignSystemPicker");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/design/src/components/SkillPicker.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SkillPicker",
    ()=>SkillPicker
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/lib/utils.ts [app-client] (ecmascript)");
"use client";
;
;
function SkillPicker({ skills, value, onChange, disabled }) {
    const selected = skills.find((skill)=>skill.id === value);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
        className: "flex flex-col gap-1.5",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-sm font-medium text-foreground",
                children: "디자인 스킬"
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/SkillPicker.tsx",
                lineNumber: 25,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("select", {
                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("h-10 rounded-md border border-input bg-card px-3 text-sm", "focus:outline-none focus:ring-2 focus:ring-ring", disabled && "cursor-not-allowed opacity-60"),
                value: value,
                disabled: disabled || skills.length === 0,
                onChange: (event)=>onChange(event.target.value),
                children: skills.length === 0 ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                    value: "",
                    children: "불러오는 중…"
                }, void 0, false, {
                    fileName: "[project]/apps/design/src/components/SkillPicker.tsx",
                    lineNumber: 37,
                    columnNumber: 11
                }, this) : skills.map((skill)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                        value: skill.id,
                        children: skill.title
                    }, skill.id, false, {
                        fileName: "[project]/apps/design/src/components/SkillPicker.tsx",
                        lineNumber: 40,
                        columnNumber: 13
                    }, this))
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/SkillPicker.tsx",
                lineNumber: 26,
                columnNumber: 7
            }, this),
            selected ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-xs text-muted-foreground",
                children: selected.description
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/SkillPicker.tsx",
                lineNumber: 47,
                columnNumber: 9
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/apps/design/src/components/SkillPicker.tsx",
        lineNumber: 24,
        columnNumber: 5
    }, this);
}
_c = SkillPicker;
var _c;
__turbopack_context__.k.register(_c, "SkillPicker");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/design/src/components/Composer.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Composer",
    ()=>Composer
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/loader-circle.mjs [app-client] (ecmascript) <export default as Loader2>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$play$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Play$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/play.mjs [app-client] (ecmascript) <export default as Play>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$square$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Square$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/square.mjs [app-client] (ecmascript) <export default as Square>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/lib/utils.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$DesignSystemPicker$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/components/DesignSystemPicker.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$SkillPicker$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/components/SkillPicker.tsx [app-client] (ecmascript)");
"use client";
;
;
;
;
;
function Composer({ prompt, onPromptChange, skills, skillId, onSkillChange, designSystems, designSystemId, onDesignSystemChange, isRunning, optionsLoading, onRun, onStop }) {
    const canRun = prompt.trim().length > 0 && skillId.length > 0 && !isRunning;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                className: "flex flex-col gap-1.5",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "text-sm font-medium text-foreground",
                        children: "Brief"
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/Composer.tsx",
                        lineNumber: 48,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("textarea", {
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("min-h-32 resize-y rounded-md border border-input bg-card p-3 text-sm", "focus:outline-none focus:ring-2 focus:ring-ring"),
                        placeholder: "만들고 싶은 단일 페이지 HTML을 설명하세요. 예: 'SaaS 랜딩 페이지 — 히어로, 기능 3개, 가격표, 푸터'",
                        value: prompt,
                        disabled: isRunning,
                        onChange: (event)=>onPromptChange(event.target.value),
                        onKeyDown: (event)=>{
                            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault();
                                if (canRun) onRun();
                            }
                        }
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/Composer.tsx",
                        lineNumber: 49,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/components/Composer.tsx",
                lineNumber: 47,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "grid grid-cols-1 gap-4 sm:grid-cols-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$SkillPicker$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SkillPicker"], {
                        skills: skills,
                        value: skillId,
                        onChange: onSkillChange,
                        disabled: isRunning || optionsLoading
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/Composer.tsx",
                        lineNumber: 68,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$DesignSystemPicker$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DesignSystemPicker"], {
                        designSystems: designSystems,
                        value: designSystemId,
                        onChange: onDesignSystemChange,
                        disabled: isRunning || optionsLoading
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/Composer.tsx",
                        lineNumber: 74,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/components/Composer.tsx",
                lineNumber: 67,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center justify-between gap-3",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "text-xs text-muted-foreground",
                        children: "⌘/Ctrl + Enter 로 실행"
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/Composer.tsx",
                        lineNumber: 83,
                        columnNumber: 9
                    }, this),
                    isRunning ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        type: "button",
                        onClick: onStop,
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium", "bg-destructive text-white hover:opacity-90"),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$square$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Square$3e$__["Square"], {
                                className: "size-4"
                            }, void 0, false, {
                                fileName: "[project]/apps/design/src/components/Composer.tsx",
                                lineNumber: 95,
                                columnNumber: 13
                            }, this),
                            "중지"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/design/src/components/Composer.tsx",
                        lineNumber: 87,
                        columnNumber: 11
                    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        type: "button",
                        onClick: onRun,
                        disabled: !canRun,
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium", "bg-primary text-primary-foreground hover:opacity-90", !canRun && "cursor-not-allowed opacity-50"),
                        children: [
                            optionsLoading ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                                className: "size-4 animate-spin"
                            }, void 0, false, {
                                fileName: "[project]/apps/design/src/components/Composer.tsx",
                                lineNumber: 110,
                                columnNumber: 15
                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$play$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Play$3e$__["Play"], {
                                className: "size-4"
                            }, void 0, false, {
                                fileName: "[project]/apps/design/src/components/Composer.tsx",
                                lineNumber: 112,
                                columnNumber: 15
                            }, this),
                            "실행"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/design/src/components/Composer.tsx",
                        lineNumber: 99,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/components/Composer.tsx",
                lineNumber: 82,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/design/src/components/Composer.tsx",
        lineNumber: 46,
        columnNumber: 5
    }, this);
}
_c = Composer;
var _c;
__turbopack_context__.k.register(_c, "Composer");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/design/src/components/RunStream.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RunStream",
    ()=>RunStream
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$alert$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__AlertCircle$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/circle-alert.mjs [app-client] (ecmascript) <export default as AlertCircle>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$check$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CheckCircle2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/circle-check.mjs [app-client] (ecmascript) <export default as CheckCircle2>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/loader-circle.mjs [app-client] (ecmascript) <export default as Loader2>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$x$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__XCircle$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/circle-x.mjs [app-client] (ecmascript) <export default as XCircle>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/lib/utils.ts [app-client] (ecmascript)");
"use client";
;
;
;
function RunStream({ phase, statusLabel, text, error }) {
    if (phase === "idle") {
        return null;
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center gap-2 text-sm font-medium",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(PhaseIcon, {
                        phase: phase
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/RunStream.tsx",
                        lineNumber: 25,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: phaseHeadline(phase)
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/RunStream.tsx",
                        lineNumber: 26,
                        columnNumber: 9
                    }, this),
                    statusLabel && phase === "running" ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "text-muted-foreground",
                        children: [
                            "· ",
                            statusLabel
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/design/src/components/RunStream.tsx",
                        lineNumber: 28,
                        columnNumber: 11
                    }, this) : null
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/components/RunStream.tsx",
                lineNumber: 24,
                columnNumber: 7
            }, this),
            error ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "flex items-start gap-1.5 text-sm text-destructive",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$alert$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__AlertCircle$3e$__["AlertCircle"], {
                        className: "mt-0.5 size-4 shrink-0"
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/RunStream.tsx",
                        lineNumber: 34,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: error
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/components/RunStream.tsx",
                        lineNumber: 35,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/components/RunStream.tsx",
                lineNumber: 33,
                columnNumber: 9
            }, this) : null,
            text ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("pre", {
                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3", "font-mono text-xs text-muted-foreground"),
                children: text
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/RunStream.tsx",
                lineNumber: 40,
                columnNumber: 9
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/apps/design/src/components/RunStream.tsx",
        lineNumber: 23,
        columnNumber: 5
    }, this);
}
_c = RunStream;
function PhaseIcon({ phase }) {
    switch(phase){
        case "running":
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                className: "size-4 animate-spin text-primary"
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/RunStream.tsx",
                lineNumber: 56,
                columnNumber: 14
            }, this);
        case "succeeded":
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$check$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CheckCircle2$3e$__["CheckCircle2"], {
                className: "size-4 text-green-600"
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/RunStream.tsx",
                lineNumber: 58,
                columnNumber: 14
            }, this);
        case "failed":
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$x$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__XCircle$3e$__["XCircle"], {
                className: "size-4 text-destructive"
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/RunStream.tsx",
                lineNumber: 60,
                columnNumber: 14
            }, this);
        case "aborted":
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$alert$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__AlertCircle$3e$__["AlertCircle"], {
                className: "size-4 text-muted-foreground"
            }, void 0, false, {
                fileName: "[project]/apps/design/src/components/RunStream.tsx",
                lineNumber: 62,
                columnNumber: 14
            }, this);
        default:
            return null;
    }
}
_c1 = PhaseIcon;
function phaseHeadline(phase) {
    switch(phase){
        case "running":
            return "실행 중";
        case "succeeded":
            return "완료";
        case "failed":
            return "실패";
        case "aborted":
            return "중지됨";
        default:
            return "";
    }
}
var _c, _c1;
__turbopack_context__.k.register(_c, "RunStream");
__turbopack_context__.k.register(_c1, "PhaseIcon");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/design/src/app/page.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>HomePage
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$sparkles$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Sparkles$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/sparkles.mjs [app-client] (ecmascript) <export default as Sparkles>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$ArtifactPreview$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/components/ArtifactPreview.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$Composer$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/components/Composer.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$RunStream$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/components/RunStream.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$design$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/design/src/lib/design-api.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
function HomePage() {
    _s();
    // 선택지(서버에서 로드 — 프론트 하드코딩 금지).
    const [skills, setSkills] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [designSystems, setDesignSystems] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [optionsLoading, setOptionsLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(true);
    const [optionsError, setOptionsError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    // 컴포저 상태.
    const [prompt, setPrompt] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [skillId, setSkillId] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [designSystemId, setDesignSystemId] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    // 런 상태.
    const [phase, setPhase] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("idle");
    const [statusLabel, setStatusLabel] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [streamText, setStreamText] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [runError, setRunError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [runId, setRunId] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [artifact, setArtifact] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const abortRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    // 옵션 로드. optionsLoading 초기값이 true이므로 effect 본문에서 동기 setState
    // 하지 않고 async 콜백 안에서만 상태를 갱신한다(react-hooks/set-state-in-effect).
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "HomePage.useEffect": ()=>{
            const controller = new AbortController();
            void ({
                "HomePage.useEffect": async ()=>{
                    try {
                        const options = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$design$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fetchDesignOptions"])(controller.signal);
                        setSkills(options.skills);
                        setDesignSystems(options.designSystems);
                        setSkillId(options.defaultSkillId || options.skills[0]?.id || "");
                    } catch (error) {
                        if (controller.signal.aborted) return;
                        setOptionsError(error instanceof Error ? error.message : "옵션 로드 실패");
                    } finally{
                        if (!controller.signal.aborted) setOptionsLoading(false);
                    }
                }
            })["HomePage.useEffect"]();
            return ({
                "HomePage.useEffect": ()=>controller.abort()
            })["HomePage.useEffect"];
        }
    }["HomePage.useEffect"], []);
    // 언마운트 시 진행 중 스트림 정리.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "HomePage.useEffect": ()=>{
            return ({
                "HomePage.useEffect": ()=>abortRef.current?.abort()
            })["HomePage.useEffect"];
        }
    }["HomePage.useEffect"], []);
    const isRunning = phase === "running";
    const handleStop = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "HomePage.useCallback[handleStop]": ()=>{
            abortRef.current?.abort();
        }
    }["HomePage.useCallback[handleStop]"], []);
    const handleRun = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "HomePage.useCallback[handleRun]": async ()=>{
            if (!prompt.trim() || !skillId) return;
            // 런 상태 리셋.
            const controller = new AbortController();
            abortRef.current = controller;
            setPhase("running");
            setStatusLabel("요청 보내는 중…");
            setStreamText("");
            setRunError(null);
            setRunId(null);
            setArtifact(null);
            try {
                await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$lib$2f$design$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["streamDesignRun"])({
                    request: {
                        prompt: prompt.trim(),
                        skillId,
                        designSystemId
                    },
                    signal: controller.signal,
                    onEvent: {
                        "HomePage.useCallback[handleRun]": (event)=>handleStreamEvent(event)
                    }["HomePage.useCallback[handleRun]"]
                });
            } catch (error) {
                if (controller.signal.aborted) {
                    // AbortController.abort() → 사용자가 중지함.
                    setPhase({
                        "HomePage.useCallback[handleRun]": (current)=>current === "running" ? "aborted" : current
                    }["HomePage.useCallback[handleRun]"]);
                    setStatusLabel("");
                    return;
                }
                setRunError(error instanceof Error ? error.message : "실행 실패");
                setPhase("failed");
                setStatusLabel("");
            } finally{
                if (abortRef.current === controller) {
                    abortRef.current = null;
                }
            }
            function handleStreamEvent(event) {
                switch(event.type){
                    case "start":
                        setRunId(event.runId);
                        setStatusLabel("실행 시작");
                        break;
                    case "progress":
                        setStatusLabel(event.label);
                        break;
                    case "text":
                        setStreamText({
                            "HomePage.useCallback[handleRun].handleStreamEvent": (prev)=>prev + event.delta
                        }["HomePage.useCallback[handleRun].handleStreamEvent"]);
                        break;
                    case "artifact":
                        // streaming → complete 모두 반영. primary 아티팩트로 최신을 사용.
                        setArtifact(event.artifact);
                        break;
                    case "done":
                        setPhase(event.status);
                        setStatusLabel("");
                        // done.artifacts는 전부 complete. 마지막 것을 primary로.
                        if (event.artifacts.length > 0) {
                            setArtifact(event.artifacts[event.artifacts.length - 1]);
                        }
                        break;
                    case "error":
                        setRunError(event.message);
                        break;
                    default:
                        break;
                }
            }
        }
    }["HomePage.useCallback[handleRun]"], [
        prompt,
        skillId,
        designSystemId
    ]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("main", {
        className: "mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-6",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("header", {
                className: "flex items-center gap-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$sparkles$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Sparkles$3e$__["Sparkles"], {
                        className: "size-5 text-primary"
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/app/page.tsx",
                        lineNumber: 146,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                        className: "text-lg font-semibold",
                        children: "Pie Design Studio"
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/app/page.tsx",
                        lineNumber: 147,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "text-sm text-muted-foreground",
                        children: "brief → 단일 페이지 HTML 아티팩트"
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/app/page.tsx",
                        lineNumber: 148,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/app/page.tsx",
                lineNumber: 145,
                columnNumber: 7
            }, this),
            optionsError ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive",
                children: [
                    "옵션 로드 실패: ",
                    optionsError,
                    ". 서버(`/v1/design/options`)가 실행 중인지 확인하세요."
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/app/page.tsx",
                lineNumber: 154,
                columnNumber: 9
            }, this) : null,
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "grid grid-cols-1 gap-6 lg:grid-cols-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex flex-col gap-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$Composer$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Composer"], {
                                prompt: prompt,
                                onPromptChange: setPrompt,
                                skills: skills,
                                skillId: skillId,
                                onSkillChange: setSkillId,
                                designSystems: designSystems,
                                designSystemId: designSystemId,
                                onDesignSystemChange: setDesignSystemId,
                                isRunning: isRunning,
                                optionsLoading: optionsLoading,
                                onRun: handleRun,
                                onStop: handleStop
                            }, void 0, false, {
                                fileName: "[project]/apps/design/src/app/page.tsx",
                                lineNumber: 162,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$RunStream$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RunStream"], {
                                phase: phase,
                                statusLabel: statusLabel,
                                text: streamText,
                                error: runError
                            }, void 0, false, {
                                fileName: "[project]/apps/design/src/app/page.tsx",
                                lineNumber: 176,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/design/src/app/page.tsx",
                        lineNumber: 161,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "min-h-[60vh] lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$design$2f$src$2f$components$2f$ArtifactPreview$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ArtifactPreview"], {
                            runId: runId,
                            artifact: artifact
                        }, void 0, false, {
                            fileName: "[project]/apps/design/src/app/page.tsx",
                            lineNumber: 185,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/apps/design/src/app/page.tsx",
                        lineNumber: 184,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/design/src/app/page.tsx",
                lineNumber: 160,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/design/src/app/page.tsx",
        lineNumber: 144,
        columnNumber: 5
    }, this);
}
_s(HomePage, "qw6w6cLl0fMlB3WxjN6N3wJ+RIk=");
_c = HomePage;
var _c;
__turbopack_context__.k.register(_c, "HomePage");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=apps_design_src_0dx7spm._.js.map