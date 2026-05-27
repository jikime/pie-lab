# Pie Gateway 구현 요약

작성일: 2026-05-26

이 문서는 Hermes agent의 gateway/automation 흐름을 참고해 `pie-lab`에 구현한 gateway 관련 작업의 현재 상태를 정리합니다. 사용법 중심 문서는 [Pie Gateway](./gateway.md)를 기준으로 보고, 이 문서는 구현 범위와 검증 상태를 확인하는 용도입니다.

## 구현 목표

기존 `/chat-connect` 방식은 열린 `pie` TUI 세션에 Telegram/Discord 채널을 붙이는 구조였습니다. 이 방식은 테스트에는 편하지만, TUI 세션을 닫으면 외부 채팅 연결도 끊어집니다.

이번 구현의 목표는 다음입니다.

```txt
Telegram/Discord message
  -> pie gateway process
  -> normalized chat runtime
  -> Pie AgentSession
  -> router + learning loop + skills + tools
  -> Telegram/Discord response

cron scheduled automation
  -> pie gateway scheduler tick
  -> Pie AgentSession or script job
  -> origin/all/chat target delivery
```

즉, `pie gateway`를 장시간 실행되는 단일 운영 프로세스로 두고, TUI를 열어두지 않아도 채팅 응답과 cron delivery가 계속 동작하도록 만드는 것이 핵심입니다.

## 완료된 기능

### 1. Gateway CLI와 daemon 실행

추가된 명령:

```bash
pie gateway setup
pie gateway run
pie gateway status
pie gateway doctor
pie gateway stop
pie gateway install
pie gateway restart
pie gateway uninstall
```

지원하는 운영 방식:

- foreground 실행: `pie gateway run`
- macOS LaunchAgent 설치
- Linux systemd user service 설치
- pid/status 파일 기반 상태 확인

관련 파일:

- `packages/coding-agent/src/gateway-cli.ts`
- `packages/coding-agent/src/core/gateway/runner.ts`
- `docs/gateway.md`

### 2. Platform Registry

기존에는 gateway adapter 시작 지점에서 `telegram`과 `discord`를 직접 분기했습니다. 지금은 `GatewayPlatformRegistry`에 platform을 등록하고, gateway 본체는 등록된 adapter를 조회해 실행합니다.

현재 built-in platform:

```txt
telegram
discord
```

각 platform은 다음 capability를 선언합니다.

```txt
Telegram: markdown, attachments, typing, polling
Discord:  markdown, attachments, typing, realtime, threads, voiceInput, voiceOutput
```

이 구조 덕분에 Slack, WhatsApp, Signal 같은 새 platform은 나중에 gateway 본체를 크게 바꾸지 않고 추가할 수 있습니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/platform-registry.ts`
- `packages/coding-agent/src/core/gateway/adapters.ts`
- `packages/coding-agent/test/gateway-platform-registry.test.ts`

### 2.1. Discord token-first setup과 channel auto-discovery

Hermes 방식에 맞춰 Discord는 봇 토큰만으로 gateway adapter를 시작할 수 있습니다. `pie gateway setup`은 기본적으로 `Discord bot token`만 입력받고, 서버/채널 ID는 필수로 요구하지 않습니다.

동작 방식:

```txt
Discord bot token configured
  -> account-level discord.js client starts
  -> DM / user mention / matching role mention / /pie command / /voice command received
  -> channel conversation auto-created
  -> ~/.pie/agent/chat/config.json에 autoDiscovered channel 저장
  -> 이후 turn부터 같은 conversation 재사용
```

기존처럼 수동으로 channel을 넣어 둔 설정도 계속 동작합니다. `allowedChannelIds`, `ignoredChannelIds`, `freeResponseChannelIds`, `homeChannelId`로 운영 정책을 줄 수 있습니다.

### 3. SessionSource와 SessionKey

Hermes 방식에 맞춰 inbound message마다 `GatewaySessionSource`를 만들고 deterministic `sessionKey`를 계산합니다.

기본 형태:

```txt
gateway:<service>:<account>:dm:<chat>
gateway:<service>:<account>:channel:<chat>
gateway:<service>:<account>:thread:<parent-chat>:<thread>
```

이제 같은 configured channel 안에서도 session key별로 별도 Pie session을 유지할 수 있습니다. 예를 들어 DM, channel, thread/topic이 서로 다른 대화 흐름으로 분리될 수 있습니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/session.ts`
- `packages/coding-agent/src/core/gateway/chat/runtime.ts`
- `packages/coding-agent/src/core/gateway/runner.ts`
- `packages/coding-agent/test/gateway-session.test.ts`

### 4. Scheduler delivery 통합

기존 scheduler delivery는 Telegram/Discord 전송 로직을 scheduler 쪽에서 별도로 들고 있었습니다. 지금은 scheduler delivery가 gateway delivery로 위임됩니다.

지원하는 delivery target:

```txt
local
origin
all
chat:<account/channel>
telegram:<chat-id>
discord:<channel-id>
```

`deliver=origin`으로 만든 cron 작업은 작업을 만든 채팅방으로 결과를 다시 보냅니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/delivery.ts`
- `packages/coding-agent/src/core/scheduler/delivery.ts`
- `packages/coding-agent/test/scheduler.test.ts`

### 5. Learning Loop와 skill 즉시 반영

Gateway turn도 일반 `pie` 세션과 같은 learning runtime을 사용합니다.

연결된 기능:

- persistent memory
- user memory
- skill creation/update
- skill curator
- Honcho context
- router usage/cost 기록

Gateway session은 remote turn 직전에 session resources를 reload합니다. 그래서 새 skill이 생성되거나 수정되면 gateway 프로세스를 재시작하지 않아도 다음 remote turn부터 반영됩니다.

채팅 전용 skill path:

```txt
~/.pie/agent/chat/accounts/<account>/shared/skills
~/.pie/agent/chat/accounts/<account>/channels/<channel>/workspace/skills
```

관련 파일:

- `packages/coding-agent/src/core/gateway/runner.ts`
- `packages/coding-agent/src/core/gateway/prompt.ts`
- `packages/coding-agent/src/core/gateway/tools.ts`

### 6. 음성 입력 전사

Telegram voice note와 Discord audio attachment는 자동 전사를 시도합니다. 전사 결과는 agent가 보는 transcript에 함께 들어갑니다.

전사 provider 선택 순서:

```txt
1. PIE_GATEWAY_STT_ENDPOINT
2. VOICE_TOOLS_OPENAI_KEY direct OpenAI transcription
3. OPENAI_API_KEY direct OpenAI transcription fallback
4. provider-connections.json 또는 auth.json의 `openai` credential
5. local Pie server /v1/audio/transcriptions
```

관련 환경변수:

```bash
PIE_GATEWAY_STT=0
PIE_GATEWAY_STT_ENDPOINT=...
PIE_GATEWAY_STT_MODEL=auto:stt
PIE_GATEWAY_STT_LANGUAGE=ko
PIE_GATEWAY_STT_TIMEOUT_MS=20000
PIE_GATEWAY_STT_CACHE=0
PIE_GATEWAY_STT_CACHE_DIR=...
PIE_GATEWAY_STT_MAX_BYTES=25mb
VOICE_TOOLS_OPENAI_KEY=...
OPENAI_API_KEY=...
```

전사 결과는 audio hash와 STT 설정을 기준으로 캐시됩니다. 같은 음성 파일과 같은 provider/model/prompt/language 조합이면 다음 처리부터는 provider를 다시 호출하지 않습니다.

전사가 실패해도 gateway 메시지 처리는 실패하지 않습니다. transcript에는 전사 실패 안내만 남기고, 첨부파일은 그대로 agent에게 전달합니다. 파일이 `PIE_GATEWAY_STT_MAX_BYTES`보다 크면 전사를 건너뛰고 첨부만 전달합니다.

전사 transcript에는 provider, model, cache hit 여부, 파일 크기, 처리 시간이 metadata로 함께 들어갑니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/transcription.ts`
- `packages/coding-agent/src/core/gateway/adapters.ts`
- `packages/coding-agent/test/gateway-transcription.test.ts`

### 7. 음성 응답 합성

원격 사용자가 음성/오디오 응답을 요청하면 gateway agent가 `chat_voice` tool을 사용해 짧은 답변을 음성 파일로 합성하고, 다음 reply의 첨부로 보낼 수 있습니다.

TTS provider 선택 순서:

```txt
1. PIE_GATEWAY_TTS_ENDPOINT
2. VOICE_TOOLS_OPENAI_KEY direct OpenAI speech
3. OPENAI_API_KEY direct OpenAI speech fallback
4. provider-connections.json 또는 auth.json의 `openai` credential
5. local Pie server /v1/audio/speech
```

관련 환경변수:

```bash
PIE_GATEWAY_TTS=0
PIE_GATEWAY_TTS_ENDPOINT=...
PIE_GATEWAY_TTS_API_KEY=...
PIE_GATEWAY_TTS_MODEL=auto:tts
PIE_GATEWAY_TTS_VOICE=alloy
PIE_GATEWAY_TTS_FORMAT=mp3
PIE_GATEWAY_TTS_TIMEOUT_MS=30000
PIE_GATEWAY_TTS_MAX_CHARS=2000
PIE_GATEWAY_TTS_DIR=...
VOICE_TOOLS_OPENAI_KEY=...
OPENAI_API_KEY=...
```

합성 파일은 기본적으로 `~/.pie/agent/gateway/tts`에 저장됩니다. Telegram은 audio attachment를 `sendAudio`로 전송하고, Discord는 일반 file attachment로 전송합니다. TTS provider가 없거나 실패해도 gateway turn 자체는 실패하지 않고, agent가 텍스트 답변을 계속 보낼 수 있습니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/speech.ts`
- `packages/coding-agent/src/core/gateway/tools.ts`
- `packages/coding-agent/src/core/gateway/adapters.ts`
- `packages/coding-agent/test/gateway-speech.test.ts`

### 8. Discord voice channel mode

Discord text channel에서 `/voice join` 또는 `/pie voice join`을 실행하면 봇이 사용자의 현재 voice channel에 입장합니다. 이후 발화가 끝나면 Discord Opus receive stream을 WAV로 decode하고, STT 결과를 기존 gateway conversation에 `[Voice]` 입력으로 넣습니다. Agent 응답은 텍스트 채널에 남고, voice channel에도 TTS로 재생됩니다.

지원 명령:

```txt
/voice join
/voice status
/voice leave
/pie voice join
/pie voice status
/pie voice leave
```

흐름:

```txt
Discord voice channel speech
  -> @discordjs/voice receiver
  -> prism-media + opusscript decode
  -> WAV file
  -> STT
  -> gateway agent turn
  -> Discord text reply
  -> TTS playback to voice channel
```

관련 환경변수:

```bash
PIE_GATEWAY_VOICE_SILENCE_MS=1500
PIE_GATEWAY_VOICE_MAX_MS=30000
PIE_GATEWAY_VOICE_MIN_PCM_BYTES=24000
PIE_GATEWAY_VOICE_PCM_MAX_BYTES=8388608
PIE_GATEWAY_VOICE_TTS_MAX_CHARS=900
PIE_GATEWAY_VOICE_JOIN_TIMEOUT_MS=20000
PIE_GATEWAY_VOICE_PLAY_TIMEOUT_MS=10000
```

필요한 Discord bot 설정:

- `GuildVoiceStates` intent 사용
- Connect / Speak / Use Voice Activity 권한
- 기존 text gateway 권한과 Message Content Intent
- `applications.commands` scope for `/pie voice ...`

음성 재생 중에는 수신 처리를 무시해 echo loop를 줄입니다. 실제 STT/TTS provider는 기존 gateway STT/TTS 설정을 그대로 사용합니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/discord-voice.ts`
- `packages/coding-agent/src/core/gateway/adapters.ts`
- `packages/coding-agent/test/gateway-discord-voice.test.ts`

### 9. Telegram inline control button

Telegram control command 응답에는 inline button이 함께 표시됩니다.

지원 버튼:

```txt
Status
New
Compact
Stop
Help
```

버튼 클릭은 Telegram `callback_query`로 들어오며, 기존 `/status`, `/new`, `/compact`, `/stop`, `/help`와 같은 control path를 사용합니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/adapters.ts`

### 10. Discord slash command

Gateway 시작 시 Discord guild command를 등록하거나 갱신합니다.

지원 명령:

```txt
/pie status
/pie new
/pie compact
/pie stop
/pie help
/pie voice join
/pie voice leave
/pie voice status
```

Discord 봇에는 `applications.commands` scope가 필요합니다. slash command 등록이 실패해도 gateway는 중단하지 않고 adapter health의 `lastError`에 기록합니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/adapters.ts`

### 11. Gateway health와 doctor

`pie gateway status`는 pid뿐 아니라 status file, adapter 상태, queue length, session count를 표시할 수 있습니다.

`pie gateway doctor`는 다음 항목을 점검합니다.

- chat config 디렉터리와 JSON 유효성
- configured account/channel 개수
- gateway pid/status file
- scheduler 활성화 여부
- Telegram bot token 유효성
- Telegram chat 접근 가능 여부
- Discord bot token, optional guild/channel/home channel 접근성
- Discord slash command 접근성
- STT 설정, cache, file size limit, local Pie server media route 접근성
- TTS 설정, output directory, text length limit, local Pie server media route 접근성
- Discord voice dependency와 ffmpeg 접근성

실패가 있으면 exit code `1`을 반환하고, 경고만 있으면 성공으로 종료합니다.

관련 파일:

- `packages/coding-agent/src/core/gateway/doctor.ts`
- `packages/coding-agent/src/core/gateway/runner.ts`
- `packages/coding-agent/src/gateway-cli.ts`

## 현재 검증 상태

실행한 검증:

```bash
npx vitest --run packages/coding-agent/test/gateway-platform-registry.test.ts packages/coding-agent/test/gateway-session.test.ts packages/coding-agent/test/gateway-transcription.test.ts packages/coding-agent/test/scheduler.test.ts
npx vitest --run packages/coding-agent/test/gateway-speech.test.ts
npx vitest --run packages/coding-agent/test/gateway-discord-voice.test.ts
npm run build --workspace=@pie-lab/coding-agent
npm run build
git diff --check
node packages/coding-agent/dist/cli.js gateway doctor
```

검증 결과:

```txt
gateway registry/session/transcription/scheduler tests passed
gateway speech tests passed
gateway discord voice helper tests passed
coding-agent build passed
root build passed
diff whitespace check passed
gateway doctor command executed successfully
```

실제 `gateway doctor` 실행 시 확인된 현재 환경 경고:

```txt
WARN health: 이전 gateway 프로세스가 실행 중이라 status.json이 아직 없음
WARN stt: OpenAI credential, PIE_GATEWAY_STT_ENDPOINT가 없고 local Pie server가 꺼져 있음
WARN tts: OpenAI credential, PIE_GATEWAY_TTS_ENDPOINT가 없고 local Pie server가 꺼져 있음
```

첫 번째 경고는 새 gateway 코드로 재시작하면 해결됩니다.

```bash
pie gateway restart
```

두 번째 경고는 음성 전사를 쓰려면 다음 중 하나가 필요하다는 뜻입니다.

```bash
pie gateway audio set
# 또는
export VOICE_TOOLS_OPENAI_KEY=...
# 또는
export OPENAI_API_KEY=...
# 또는
export PIE_GATEWAY_STT_ENDPOINT=...
# 또는
# dashboard Providers / auth.json에 OpenAI key 저장
# 또는
npm --workspace @pie-lab/server run dev
```

TTS 경고도 같은 방식으로 해결할 수 있습니다. OpenAI direct speech를 쓰려면 `pie gateway audio set`으로 저장한 `openai-audio` credential, 저장된 `openai` provider connection, `VOICE_TOOLS_OPENAI_KEY` 또는 `OPENAI_API_KEY`가 필요합니다. gateway 전용 endpoint를 쓰려면 `PIE_GATEWAY_TTS_ENDPOINT`, router를 쓰려면 local Pie server가 필요합니다. `openai-codex` 로그인은 coding agent provider용이라 OpenAI audio API key로 취급하지 않습니다.

## 현재 한계

아직 Hermes와 완전히 같은 수준은 아닙니다.

오디오 기능은 Hermes Agent에 있는 STT/TTS/gateway audio 기능만 parity 대상으로 삼습니다. Hermes에 없는 audio provider, channel/account별 음성 정책, dashboard 중심 audio workflow, Discord voice UX는 임의로 추가하지 않습니다.

남아 있는 차이:

- Slack, WhatsApp, Signal platform adapter는 아직 없음
- Discord token-first setup과 channel auto-discovery는 구현됐지만 실제 Discord 서버 E2E 검증이 필요함
- Discord voice channel은 기본 구현이 들어갔지만 실제 Discord 서버 E2E 검증이 아직 필요함
- voice channel playback은 local ffmpeg와 TTS provider 상태에 영향을 받음
- Telegram topic routing은 session key 기반만 준비된 상태이며, topic별 configuration UX는 더 필요함
- Discord thread의 완전한 channel/thread routing은 더 보강할 여지가 있음
- `pie gateway logs --follow` 같은 로그 명령은 아직 없음

## 2026-05-27 추가 구현

### Web Chat Gateway 채널

웹 채팅(`apps/chat`)을 Telegram/Discord와 동등한 gateway 채널로 연결했습니다. 자세한 내용은 [Web Chat Gateway](./web-chat-gateway.md)를 참고합니다.

핵심 변경:

- `web-ipc-server.ts` — gateway daemon 안에 Unix socket 서버 내장
- `web-ipc-client.ts` — API 서버에서 gateway로 연결하는 클라이언트
- gateway 실행 중이면 IPC 라우팅, 없으면 독립 세션 폴백
- `conversationId` localStorage 영속 + JSONL 이력 복원 API

### `pie session` CLI 및 `session_search` 에이전트 도구

대화 이력 전체 텍스트 검색 기능을 추가했습니다. 자세한 내용은 [Session Search](./session-search.md)를 참고합니다.

```bash
pie session list                         # 전체 세션 목록
pie session search “배포 이슈”           # FTS5 검색
pie session search “안녕” --source tui  # 소스 필터
```

TUI 세션 AI도 `session_search` 도구로 과거 대화를 검색할 수 있습니다.

### `pie gateway history` / `pie gateway attach`

CLI에서 gateway 채팅 내역을 직접 조회하거나 실시간 스트리밍하는 명령을 추가했습니다.

```bash
# 채널 목록 확인
pie gateway history

# 특정 채널 최근 대화 출력
pie gateway history dm-donghak-kim --limit 20
pie gateway history channel-1465535874778271823

# 실시간 스트리밍 (gateway가 메시지 수신/응답할 때마다 출력)
pie gateway attach
pie gateway attach dm-donghak-kim
```

- `history`: `channel.jsonl` JSONL 파싱 → inbound/outbound/error 레코드 렌더링
- `attach`: `fs.watch()`로 channel.jsonl 실시간 감시, Ctrl+C로 종료
- 채널 지정은 channelKey, accountId/channelKey, 이름 부분 문자열 모두 허용

### Telegram 슬래시 커맨드 메뉴

기존에 모든 응답 아래 표시되던 인라인 버튼(Status/New/Compact/Stop/Help)을 제거하고, gateway 시작 시 `setMyCommands` API로 봇 커맨드 메뉴에 등록하는 방식으로 전환했습니다.

- 사용자가 `/` 입력 시 자동완성 메뉴에 표시
- 기존 `parseControlCommand()`가 이미 `/status`, `/new` 등을 처리하므로 추가 라우팅 불필요
- 등록 실패 시 non-fatal (`.catch(() => undefined)`)

### 2026-05-27 추가 구현 — Curator LLM 통합 패스

**LLM 기반 스킬 통합(Consolidation) 패스를 `SkillCurator`에 추가했습니다.**

Hermes agent의 `curator.py` 1781 LOC 통합 엔진에서 핵심 로직을 포팅해, 좁은(narrow) 스킬들을 클래스 단위(umbrella) 스킬로 병합하는 기능을 구현했습니다.

추가된 기능:

- `SkillCurator.consolidate(streamFn, options)` — LLM이 도구를 호출하며 스킬 라이브러리를 직접 정리
- `SkillCurator.maybeConsolidate(streamFn, options)` — 7일 간격으로 자동 통합 (세션 종료 시 트리거)
- `SkillCurator.getConsolidationState()` — 마지막 통합 시점/횟수 조회
- `pie curator consolidate [--dry-run]` — CLI에서 수동으로 통합 패스 실행
- `pie curator status` — 스킬 상태 + 마지막 통합 정보 함께 표시
- `pie curator settings --consolidate-days N` — 통합 주기 설정
- `.curator_state` JSON 파일로 통합 타이밍 영속화

LLM 통합 패스 동작 방식:

1. 활성 agent-created 스킬 전체를 컨텍스트로 전달
2. LLM이 `skills_list`, `skill_view`, `skill_manage` 도구를 호출하며 클러스터 식별
3. PREFIX 기준 클러스터(gateway-*, discord-*, session-* 등) → umbrella 스킬로 통합
4. 통합 후 좁은 스킬을 archive, YAML 요약 반환
5. dry-run 모드: 실제 변경 없이 리포트만 생성

관련 파일:

- `packages/coding-agent/src/core/learning/skill-curator.ts` — consolidate/maybeConsolidate 추가
- `packages/coding-agent/src/core/learning/learning-settings.ts` — `consolidateIntervalDays` 필드 추가
- `packages/coding-agent/src/core/agent-session.ts` — `skillCurator` 설정 + agent_end 트리거
- `packages/coding-agent/src/core/sdk.ts` — SkillCurator 인스턴스 생성 및 AgentSession 주입
- `packages/coding-agent/src/curator-cli.ts` — `consolidate` 명령 추가
- `packages/coding-agent/test/curator-consolidate.test.ts` — 8개 단위 테스트

## 다음 추천 작업

우선순위는 다음이 좋습니다.

```txt
1. Discord thread continuity 보강
2. Telegram topic routing 보강
3. 실제 Telegram/Discord E2E 체크리스트 갱신
4. Discord voice channel 실제 서버 E2E 검증과 polish
5. pie gateway logs --follow (게이트웨이 로그 실시간 추적)
6. Honcho model-callable tools (hermes의 4개 도구 포팅)
```

지금 상태는 “Telegram/Discord/Web 중심의 Hermes-style gateway v2.1” 정도로 볼 수 있습니다. 단일 gateway process, platform registry, session key, scheduler delivery, native control UX, doctor, web IPC, 세션 검색, 대화 내역 CLI, LLM 기반 스킬 통합 패스까지 들어갔으므로 운영 기반은 갖춰졌고, 다음은 안정화와 platform coverage 확장 단계입니다.

오디오 쪽 다음 작업은 별도 확장이 아니라 [Pie Gateway Audio](./gateway-audio.md)의 Hermes parity 목록만 기준으로 진행합니다.
