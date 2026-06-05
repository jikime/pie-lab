# Coding Agent Enhancements Status

## Overview

This document tracks the coding-agent enhancement work against the `../oh-my-pi`
reference implementation. The current `pie-lab` implementation now includes the
safe core of the reference workflow:

- session-scoped Hashline snapshots
- `read` output with `¶PATH#TAG` headers and numbered text rows
- strict Hashline patch input for `edit`
- conservative stale-snapshot recovery for Hashline patches
- merge-conflict discovery through `read`
- `conflict://<id>` read/write resolution
- internal URL routing through per-scheme handlers
- expanded LSP diagnostics, rename, code action, capabilities, and status
- DAP adapter sessions with breakpoints, stack/scopes/variables/evaluate actions

It is still not a complete `oh-my-pi` port. The remaining gaps are called out
explicitly below.

## Current Tool Surface

The following tools are registered in `packages/coding-agent/src/core/tools`:

- `read`, `bash`, `edit`, `write`
- `grep`, `find`, `ls`
- `code-review`, `commit-splitter`
- `lsp`, `dap`

Normal coding sessions enable `read`, `bash`, `edit`, and `write` by default.
`AgentSession` wires those tools with a shared in-memory Hashline snapshot store
and merge-conflict history.

## Implemented Scope

### Hashline Snapshots and Patches

Implementation:

- `packages/hashline/src/format.ts`
- `packages/hashline/src/snapshots.ts`
- `packages/hashline/src/patch.ts`
- `packages/hashline/src/apply.ts`
- `packages/coding-agent/src/core/tools/read.ts`
- `packages/coding-agent/src/core/tools/edit.ts`
- `packages/coding-agent/src/core/agent-session.ts`

Behavior:

- `read` records a normalized text snapshot for editable text files.
- Hashline-enabled `read` emits `¶PATH#TAG` plus `LINE:TEXT` rows.
- Continuation/truncation notices stay outside numbered file content.
- `edit` accepts Hashline patch input via `input`.
- Supported patch operations:
  - `replace N..M:` followed by `+` body rows
  - `delete N..M`
  - `insert before N:` followed by `+` body rows
  - `insert after N:` followed by `+` body rows
  - `insert head:` followed by `+` body rows
  - `insert tail:` followed by `+` body rows
- Patch application is atomic per call: all targets are validated before writes.
- Stale file tags recover when the original target block or anchor can be
  relocated exactly and uniquely in the current file.
- Stale recovery applies the patch to the current file contents, so unrelated
  edits made after `read` are preserved.
- Stale recovery fails fast with an explicit re-read error when the target block
  changed, disappeared, or remains ambiguous after adding nearby context.
- Overlapping concrete ranges and inserts inside replace/delete ranges are
  rejected.
- Existing exact replacement edits remain available and still reject ambiguous
  matches.

Current limitation:

- Stale recovery is intentionally exact and conservative. It does not attempt a
  fuzzy three-way merge when the target text itself changed; in those cases the
  user or model must re-read and retry.

### Merge Conflict URLs

Implementation:

- `packages/hashline/src/conflict.ts`
- `packages/coding-agent/src/core/tools/conflict-history.ts`
- `packages/coding-agent/src/core/tools/read.ts`
- `packages/coding-agent/src/core/tools/write.ts`

Behavior:

- `read` detects Git conflict markers in text files.
- Each conflict is registered in session memory and surfaced as
  `conflict://<id>`.
- `read conflict://<id>` renders the captured conflict region.
- `write conflict://<id>` splices the provided resolution into the original file.
- The resolver verifies that the recorded marker still matches the current file
  before writing.
- File writes and edits clear stale conflict entries for the affected path.

Current limitation:

- Conflict history is session-local and intentionally conservative. If a conflict
  region changes, the tool requires a re-read instead of attempting recovery.

### Internal URLs

Implementation:

- `packages/coding-agent/src/core/tools/internal-urls.ts`
- `packages/coding-agent/src/core/tools/github-api.ts`
- `packages/coding-agent/src/core/tools/read.ts`
- `packages/coding-agent/src/core/tools/write.ts`

Currently supported schemes:

```text
pr://owner/repo/123
issue://owner/repo/456
agent://agent-name
skill://skill-name
rule://rule-id
conflict://conflict-id
```

`read` resolves supported internal URLs asynchronously and returns content
normally. GitHub-backed URL resolution is typed and does not rely on implicit
`any`.

Behavior:

- Internal URLs are parsed into typed `InternalURL` objects.
- `InternalURLRouter` dispatches each scheme through a registered handler.
- `read` accepts a custom router, so tests and extensions can override scheme
  behavior without modifying the read tool.
- `conflict://` reads use the same router path and receive session conflict
  history through resolver context.

Current limitation:

- This is still a compact built-in router. It does not yet include the full
  `oh-my-pi` protocol catalog such as vault, MCP, memory, artifact, and local
  resource handlers.

### Code Review

Implementation:

- `packages/coding-agent/src/core/tools/code-review.ts`

The tool analyzes git diff output and TypeScript compiler output. It is a
registered agent tool, not a standalone CLI subcommand.

Limitations:

- Regex-based issue detection.
- No AST analysis.
- Runs `npx tsc --noEmit --skipLibCheck` through the tool operation layer.

### Commit Splitter

Implementation:

- `packages/coding-agent/src/core/tools/commit-splitter.ts`

The tool groups diff hunks by path/content heuristics. It produces a suggested
commit plan only. It does not stage, commit, or split hunks automatically.

### LSP

Implementation:

- `packages/coding-agent/src/core/tools/lsp.ts`
- `packages/coding-agent/src/utils/lsp-client.ts`

The current LSP tool supports TypeScript/JavaScript hover, definition,
references, diagnostics, rename, code actions, capabilities, and status. The
JSON-RPC client distinguishes requests from notifications, caches published
diagnostics, and pools clients per working directory.

Behavior:

- `diagnostics` opens/saves a document and waits briefly for
  `textDocument/publishDiagnostics`.
- `rename` requests `textDocument/rename` and can optionally apply returned
  workspace edits.
- `code_actions` requests `textDocument/codeAction`, lists available actions,
  and can optionally apply a selected action's workspace edit.
- `capabilities` reports the initialized server capabilities.
- `status` reports client lifecycle and diagnostic cache state.
- Tool-level tests use an injected fake client, so regressions do not require a
  real language server or paid provider.

Remaining gaps:

- server configuration
- explicit reload action
- full multi-server selection and project-aware server config
- richer mock-server protocol tests beyond tool-level injected client coverage

### DAP

Implementation:

- `packages/coding-agent/src/core/tools/dap.ts`
- `packages/coding-agent/src/utils/dap-client.ts`

The current `dap` tool still supports `run` for direct Node execution, and now
supports real Debug Adapter Protocol sessions when an `adapterCommand` is
provided.

Behavior:

- `debug` starts a stdio DAP adapter, sends `initialize`, optional
  `setBreakpoints`, `launch`, and `configurationDone`.
- Active sessions are kept by id.
- `set_breakpoints`, `continue`, `stack_trace`, `scopes`, `variables`,
  `evaluate`, `disconnect`, and `status` operate on an active session.
- Output, stopped, terminated, and exited DAP events are buffered into session
  state.
- Tool-level tests use an injected fake DAP client, so regressions do not need a
  real adapter binary.

Remaining gaps:

- stepping
- automatic adapter selection and bundled adapter defaults
- richer adapter-specific launch profiles
- protocol-level mock adapter tests beyond tool-level injected client coverage

## Remaining Porting Plan

The original four-item porting pass is implemented at the compact core level.
To reach broader `oh-my-pi` parity, continue in this order:

1. Add the remaining internal URL schemes from `oh-my-pi` as separate handlers.
2. Add LSP server configuration files, server selection, and multi-server
   diagnostics/rename coordination.
3. Add DAP adapter discovery/defaults and stepping actions.
4. Add protocol-level mock servers for LSP and DAP in addition to the current
   injected-client regression tests.

## Verification Expectations

For code changes in this area:

```bash
npm run check
```

Focused checks that are useful while developing:

```bash
npm -w @pie-lab/hashline test
npx tsc -p packages/hashline/tsconfig.build.json --noEmit
npx tsgo -p packages/coding-agent/tsconfig.build.json --noEmit
cd packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/tools.test.ts
```

## References

- `../oh-my-pi/docs/tools/edit.md`
- `../oh-my-pi/docs/tools/read.md`
- `../oh-my-pi/docs/tools/lsp.md`
- `../oh-my-pi/docs/tools/debug.md`
- Language Server Protocol: https://microsoft.github.io/language-server-protocol/
- Debug Adapter Protocol: https://microsoft.github.io/debug-adapter-protocol/
