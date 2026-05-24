# Claude Agent SDK Provider

## 목적

`claude-code-adk` provider는 Anthropic Messages API를 직접 호출하는 기존 `anthropic` provider를 대체하는 것이 아니라, router가 선택할 수 있는 별도 로컬 실행 경로입니다.

이 경로는 `@anthropic-ai/claude-agent-sdk`의 `query()`를 사용합니다. 따라서 API key 기반 third-party 호출이 아니라, 사용자의 로컬 Claude Code 로그인/구독 상태와 Claude Code 실행 계층을 사용합니다.

정확히 말하면 SDK는 우리가 직접 `claude -p` 문자열을 조립해서 실행하는 wrapper가 아닙니다. SDK의 `query()`가 로컬 Claude Code subprocess를 띄우고 `--output-format stream-json`, `--input-format stream-json` 방식으로 통신합니다. Claude Code CLI 관점에서는 headless/non-interactive 실행이지만, pie-lab에서는 SDK API를 통해 제어합니다.

## 등록된 provider와 model

```txt
provider: claude-code-adk
api:      claude-agent-sdk

models:
- claude-code-adk/claude-sonnet-4-6
- claude-code-adk/claude-opus-4-7
- claude-code-adk/claude-haiku-4-5
```

`ModelRegistry`에서는 이 provider를 API key가 필요 없는 local provider로 봅니다. 그래서 `auth.json`이나 provider connection에 API key가 없어도 `getAvailable()` 후보에 들어갑니다.

## 선택 방법

Claude 계열 모델은 `anthropic` provider와 `claude-code-adk` provider에 같은 model id가 있을 수 있습니다. 그래서 `claude-opus-4-7`처럼 model id만 보고 고르면 기존 Anthropic Messages API 경로인지, Claude Code ADK 경로인지 헷갈릴 수 있습니다.

Claude Code 로컬 로그인/구독 경로를 쓰려면 반드시 provider까지 포함한 canonical reference를 선택합니다.

```txt
/model claude-code-adk/claude-sonnet-4-6
```

반대로 아래처럼 보이면 Claude Code ADK가 아니라 기존 Anthropic provider입니다.

```txt
anthropic/claude-opus-4-7
api: anthropic-messages
```

이 경로는 Claude Code 로컬 실행이 아니라 third-party Anthropic 호출이므로, "You're out of extra usage" 오류가 날 수 있습니다.

## 실행 흐름

```txt
pie CLI 또는 apps/server /v1 요청
  -> pie-lab router
  -> auto:coding / combo / fallback resolve
  -> claude-code-adk/claude-sonnet-4-6
  -> @pie-lab/ai Claude Agent SDK provider
  -> @anthropic-ai/claude-agent-sdk query()
  -> 로컬 Claude Code 실행 계층
```

빈 router policy 기준으로 `auto:coding`은 `claude-code-adk/claude-sonnet-4-6`을 우선 후보로 고를 수 있습니다. 이미 dashboard에서 `auto:coding` alias를 직접 저장해둔 경우에는 저장된 policy가 우선하므로, 필요하면 아래처럼 fallback chain에 추가합니다.

```json
{
  "name": "auto:coding",
  "models": [
    "claude-code-adk/claude-sonnet-4-6",
    "openai-codex/gpt-5.5",
    "google/gemini-3.1-pro-preview"
  ]
}
```

현재 선택이 제대로 되었는지는 usage/dashboard나 session log에서 아래 값을 보면 됩니다.

```txt
requestedModel: claude-code-adk/claude-sonnet-4-6
resolvedProvider: claude-code-adk
api: claude-agent-sdk
```

## 인증과 주의점

- 별도 Anthropic API key를 요구하지 않습니다.
- 로컬 Claude Code가 로그인되어 있어야 합니다.
- `CLAUDE_PATH`가 있으면 그 경로를 우선 사용하고, 없으면 SDK의 built-in executable 또는 발견 가능한 native `claude` binary를 사용합니다.
- 로그인이나 구독 상태에 문제가 있으면 첫 호출이 실패할 수 있습니다. route plan에 fallback 후보가 있으면 다음 후보로 넘어갑니다.
- SDK 버전을 낮춰서 우회하지 않습니다. 현재 기준은 `@anthropic-ai/claude-agent-sdk@0.3.150`입니다.

이 provider는 순수 LLM completion provider가 아니라 Claude Code agent 실행 계층입니다. 즉, Claude Code가 자체 tool을 사용할 수 있고, repository 파일을 수정할 수 있습니다. 현재 기본 permission mode는 headless 실행 안정성을 위해 일반 사용자에서는 `bypassPermissions`, root에서는 `acceptEdits`입니다.

따라서 이 기능은 개인 로컬 개발용 provider로 다루는 것이 맞습니다. 공개 서비스에서 사용자의 claude.ai 로그인/구독을 대신 받아 proxy처럼 제공하는 구조로 확장하지 않습니다.

## 프롬프트 처리 기준

Claude Code는 이미 자체 agent system prompt와 tool 실행 계층을 갖고 있습니다. 그래서 `pi`의 기존 LLM system prompt를 그대로 덧붙이면 일반 Claude Code CLI headless 실행과 다르게 동작할 수 있습니다.

현재 기준:

- 기본값은 Claude Code preset system prompt를 그대로 사용합니다.
- `pi`의 system prompt는 기본으로 append하지 않습니다.
- 단일 사용자 요청은 transcript wrapper 없이 그대로 Claude Code에 전달합니다.
- 이전 대화가 있으면 이전 transcript는 참고용으로만 넣고, 최신 사용자 요청을 별도로 구분합니다.

이 기준으로 `claude-code-adk/claude-sonnet-4-6` 직접 선택과 `auto:coding` router 선택 모두 로컬 Claude Code 로그인/구독 경로에서 정상 응답하는 것을 확인했습니다.

검증 명령:

```bash
node packages/coding-agent/dist/cli.js --no-session --no-tools --model claude-code-adk/claude-sonnet-4-6 -p "Reply with OK only."
node packages/coding-agent/dist/cli.js --no-session --no-tools --model auto:coding -p "Reply with OK only."
```

## 사용량 기록

SDK result의 `modelUsage`와 `total_cost_usd`를 pie-lab `Usage` 형식으로 변환합니다.

기록 기준:

```txt
requestedModel: auto:coding
resolvedProvider: claude-code-adk
resolvedModel: claude-sonnet-4-6
responseModel: SDK가 보고한 실제 Claude model
```

구독 기반 로컬 실행에서는 비용이 0 또는 SDK가 제공한 추정값으로 남을 수 있습니다. 비용 정산의 기준은 여전히 router가 resolve한 실제 provider/model입니다.
