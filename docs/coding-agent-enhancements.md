# Coding Agent Enhancements Status

## Overview

This document tracks the coding-agent enhancement work against the `../oh-my-pi`
reference implementation. The current `pie-lab` implementation now includes the
safe core of the reference workflow:

- session-scoped Hashline snapshots
- `read` output with `¶PATH#TAG` headers and numbered text rows
- strict Hashline patch input for `edit`
- merge-conflict discovery through `read`
- `conflict://<id>` read/write resolution
- stabilized internal URL, LSP, and DAP behavior

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
- Stale file tags fail fast with an explicit mismatch error.
- Overlapping concrete ranges and inserts inside replace/delete ranges are
  rejected.
- Existing exact replacement edits remain available and still reject ambiguous
  matches.

Current limitation:

- There is no automatic stale-snapshot three-way recovery yet. If the file hash
  changed after `read`, the user or model must re-read and retry.

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

Current limitation:

- This is still an inline resolver, not the full `oh-my-pi` router with
  dedicated scheme handlers.

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

The current LSP tool supports TypeScript/JavaScript hover, definition, and
references. The JSON-RPC client distinguishes requests from notifications, so
`initialized`, `didOpen`, `didClose`, and `exit` do not wait for responses.

Remaining gaps:

- diagnostics caching
- server configuration
- per-command/per-cwd client pooling
- rename
- code actions
- workspace edits
- reload/status/capabilities actions
- mock-server regression coverage

### DAP

Implementation:

- `packages/coding-agent/src/core/tools/dap.ts`
- `packages/coding-agent/src/utils/dap-client.ts`

The current `dap` tool executes Node scripts and can run with Node inspector
enabled via `--inspect`. It is not a full Debug Adapter Protocol session.

Remaining gaps:

- adapter selection
- DAP handshake
- breakpoints
- stepping
- stack traces
- scopes
- variables
- evaluation
- output event buffering
- session lifecycle management

## Remaining Porting Plan

To reach full parity with `oh-my-pi`, continue in this order:

1. Add stale-snapshot recovery using snapshot-backed three-way validation.
2. Replace the inline internal URL resolver with a router and per-scheme
   handlers.
3. Expand LSP into a session-aware client manager with diagnostics, rename, code
   actions, workspace edits, and mock-server tests.
4. Replace the Node inspector wrapper with a real DAP session implementation.
5. Add focused regression tests for each new URL scheme and recovery path.

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
