# Pie Gateway

`pie gateway`는 Telegram/Discord 메시지와 cron scheduled automation을 장시간 처리하기 위한 독립 실행 프로세스입니다.

구현 범위와 현재 검증 상태는 [Pie Gateway 구현 요약](./gateway-implementation-summary.md)에 따로 정리합니다.

기존 `/chat-connect` 방식은 열린 `pie` TUI 세션 하나에 특정 채널을 붙이는 구조입니다. 이 방식은 빠른 테스트에는 편하지만, 세션을 종료하면 연결도 끊어집니다. 반면 `pie gateway`는 별도 프로세스로 실행되며, TUI를 열어 두지 않아도 메시지를 받고 응답하며 cron tick도 함께 처리합니다.

Discord bot 생성부터 연결 검증까지의 단계별 절차는 [Discord Gateway 설정](./discord-gateway-setup.md)을 참고합니다.

STT/TTS와 Discord voice 설정은 [Pie Gateway Audio](./gateway-audio.md)에 별도로 정리합니다.

## 실행 방식

```bash
pie gateway setup
pie gateway run
```

상태 확인과 종료:

```bash
pie gateway status
pie gateway doctor
pie gateway stop
```

OpenAI audio key 저장과 확인:

```bash
pie gateway audio set
pie gateway audio status
pie gateway audio remove
```

OS 사용자 서비스로 등록:

```bash
pie gateway install
pie gateway restart
pie gateway uninstall
```

- macOS: LaunchAgent를 생성합니다.
- Linux: systemd user service를 생성합니다.
- `tmux`는 필요하지 않습니다.

## 설정 위치

Gateway는 기존 chat bridge와 같은 설정 파일을 사용합니다.

```txt
~/.pie/agent/chat/config.json
```

그래서 설정은 두 방법 중 하나로 만들 수 있습니다.

```txt
/chat-config
```

또는:

```bash
pie gateway setup
```

Discord는 Hermes 방식에 맞춰 봇 토큰 중심으로 설정합니다. `pie gateway setup`에서 Discord를 선택하면 기본적으로 `Discord bot token`만 입력합니다. 서버 ID와 채널 ID를 미리 등록하지 않아도 봇이 DM을 받거나 서버 채널에서 mention/slash/voice 명령을 받으면 해당 채널 conversation이 자동으로 생성되고 다음부터 재사용됩니다. Discord에서 봇 이름과 같은 role mention이 만들어지는 경우도 봇 호출로 처리합니다.

자동 발견된 Discord 채널은 다음 위치의 설정 파일에 `autoDiscovered: true`로 기록됩니다.

```txt
~/.pie/agent/chat/config.json
```

특정 채널만 허용하거나 제외하고 싶으면 Discord account에 `allowedChannelIds`, `ignoredChannelIds`, `freeResponseChannelIds`를 둘 수 있습니다. `homeChannelId`는 cron/notification의 기본 배송지로 사용됩니다.

## 동작 구조

```txt
Telegram/Discord message
  -> pie gateway account adapter
  -> conversation runtime log
  -> Pie agent session
  -> router + learning loop + skills + tools
  -> Markdown-rendered reply to Telegram/Discord
```

Telegram은 bot token당 하나의 polling loop만 사용합니다. Discord도 account당 하나의 `discord.js` client만 사용합니다. 이렇게 해야 여러 채널을 연결했을 때 같은 계정의 update cursor가 서로 충돌하지 않습니다. Discord는 정적 채널 목록이 없어도 account adapter를 시작할 수 있고, 실제 채널 conversation은 런타임에서 자동으로 만들어집니다.

Gateway platform은 registry에 등록됩니다. 현재 built-in platform은 Telegram과 Discord이며, gateway 본체는 더 이상 `telegram`/`discord`를 직접 분기하지 않고 등록된 platform adapter를 찾아 실행합니다.

## SessionSource와 SessionKey

Gateway는 inbound message마다 `GatewaySessionSource`를 만들고 deterministic `sessionKey`를 계산합니다.

```txt
gateway:<service>:<account>:dm:<chat>
gateway:<service>:<account>:channel:<chat>
gateway:<service>:<account>:thread:<parent-chat>:<thread>
```

같은 configured channel 안에서도 session key별로 별도 Pie session을 유지합니다. 그래서 Telegram topic, Discord thread 같은 흐름을 이후에 붙일 때 기존 채널 세션과 섞이지 않도록 확장할 수 있습니다.

## Cron과의 연결

Gateway는 scheduler tick도 함께 실행합니다. 사용자가 원격 채팅에서 `cronjob` tool을 통해 작업을 만들면, 해당 작업에는 conversation origin이 기록됩니다.

예를 들어 `deliver`를 `origin`으로 둔 cron 작업은 예약 시간이 되었을 때 생성된 채팅방으로 결과를 보냅니다.

```txt
chat request
  -> cronjob create(origin = account/channel)
  -> pie gateway scheduler tick
  -> run scheduled job
  -> deliver result back to origin chat
```

Cron delivery도 gateway platform registry의 standalone sender를 사용합니다. 즉 일반 gateway reply와 scheduled automation delivery가 같은 platform 전송 규칙을 공유합니다.

## 음성 입력 전사

Telegram voice note와 Discord audio attachment는 자동 전사를 시도합니다. 전사 결과는 agent가 보는 transcript에 함께 주입됩니다.

기본 순서는 다음과 같습니다.

```txt
PIE_GATEWAY_STT_ENDPOINT가 있으면 custom endpoint 사용
VOICE_TOOLS_OPENAI_KEY가 있으면 OpenAI audio transcription 사용
~/.pie/agent/auth.json의 openai-audio credential 사용
OPENAI_API_KEY가 있으면 OpenAI audio transcription fallback으로 사용
~/.pie/agent/provider-connections.json의 openai 연결 사용
~/.pie/agent/auth.json의 openai credential 사용
그 외에는 local Pie server http://127.0.0.1:4873/v1/audio/transcriptions 사용
```

관련 환경변수:

```bash
PIE_GATEWAY_STT=0                         # 전사 비활성화
PIE_GATEWAY_STT_ENDPOINT=...              # custom STT endpoint
PIE_GATEWAY_STT_MODEL=auto:stt            # 기본 local/custom model
PIE_GATEWAY_STT_LANGUAGE=ko               # 기본 언어
PIE_GATEWAY_STT_TIMEOUT_MS=20000          # 요청 timeout
PIE_GATEWAY_STT_CACHE=0                   # 전사 캐시 비활성화
PIE_GATEWAY_STT_CACHE_DIR=...             # 전사 캐시 위치
PIE_GATEWAY_STT_MAX_BYTES=25mb            # 전사 대상 최대 파일 크기
VOICE_TOOLS_OPENAI_KEY=...                # OpenAI audio 전용 key
OPENAI_API_KEY=...                        # OpenAI audio fallback key
```

환경변수를 매번 export하지 않아도 됩니다. Gateway 전용 OpenAI audio key는 다음 명령으로 저장합니다.

```bash
pie gateway audio set
pie gateway audio status
pie gateway audio remove
```

이 값은 `~/.pie/agent/auth.json`의 `openai-audio` credential로 저장되며, 일반 `OPENAI_API_KEY`보다 먼저 사용됩니다. dashboard의 Providers 화면이나 `/login` 흐름으로 저장된 `openai` provider connection도 fallback으로 읽습니다. `openai-codex` 로그인은 coding agent provider용이라 OpenAI audio API key로 취급하지 않습니다.

전사 결과는 audio hash와 STT 설정을 기준으로 캐시됩니다. 같은 음성 파일과 같은 provider/model/prompt/language 조합이면 다음 처리부터는 provider를 다시 호출하지 않습니다.

전사 provider가 없거나 endpoint가 실패하면 메시지 처리는 실패하지 않고, transcript에 전사 실패 안내만 남깁니다. 파일이 `PIE_GATEWAY_STT_MAX_BYTES`보다 크면 전사를 건너뛰고 첨부만 agent에게 전달합니다.

## 음성 응답 합성

Gateway agent는 원격 사용자가 음성/오디오 응답을 명시적으로 요청할 때 `chat_voice` tool로 짧은 답변을 음성 파일로 합성해 다음 reply의 첨부로 보낼 수 있습니다.

기본 순서는 다음과 같습니다.

```txt
PIE_GATEWAY_TTS_ENDPOINT가 있으면 custom endpoint 사용
VOICE_TOOLS_OPENAI_KEY가 있으면 OpenAI audio speech 사용
~/.pie/agent/auth.json의 openai-audio credential 사용
OPENAI_API_KEY가 있으면 OpenAI audio speech fallback으로 사용
~/.pie/agent/provider-connections.json의 openai 연결 사용
~/.pie/agent/auth.json의 openai credential 사용
그 외에는 local Pie server http://127.0.0.1:4873/v1/audio/speech 사용
```

관련 환경변수:

```bash
PIE_GATEWAY_TTS=0                         # 음성 응답 비활성화
PIE_GATEWAY_TTS_ENDPOINT=...              # custom TTS endpoint
PIE_GATEWAY_TTS_API_KEY=...               # custom endpoint bearer token
PIE_GATEWAY_TTS_MODEL=auto:tts            # 기본 local/custom model
PIE_GATEWAY_TTS_VOICE=alloy               # 기본 voice
PIE_GATEWAY_TTS_FORMAT=mp3                # 기본 출력 형식
PIE_GATEWAY_TTS_TIMEOUT_MS=30000          # 요청 timeout
PIE_GATEWAY_TTS_MAX_CHARS=2000            # 합성 대상 최대 글자 수
PIE_GATEWAY_TTS_DIR=...                   # 합성 파일 저장 위치
VOICE_TOOLS_OPENAI_KEY=...                # OpenAI audio 전용 key
OPENAI_API_KEY=...                        # OpenAI audio fallback key
```

환경변수를 매번 export하지 않아도 됩니다. Gateway 전용 OpenAI audio key는 `pie gateway audio set`으로 저장할 수 있고, dashboard의 Providers 화면이나 `/login` 흐름으로 저장된 `openai` provider connection도 fallback으로 읽습니다. `openai-codex` 로그인은 coding agent provider용이라 OpenAI audio API key로 취급하지 않습니다.

기본 저장 위치는 `~/.pie/agent/gateway/tts`입니다. Telegram은 audio attachment를 `sendAudio`로 보내고, Discord는 일반 file attachment로 보냅니다. TTS provider가 없거나 실패해도 gateway turn 자체는 깨지지 않으며, agent는 텍스트 답변을 계속 보낼 수 있습니다.

## Learning Loop와 Skills

Gateway agent turn은 일반 `pie` 세션과 같은 Learning Loop를 사용합니다.

- `~/.pie/agent/memories`
- `~/.pie/agent/skills`
- `.pie/skills`
- background review
- skill creation/update
- skill curator

또한 채팅 전용 skill path도 system prompt에 포함됩니다.

```txt
~/.pie/agent/chat/accounts/<account>/shared/skills
~/.pie/agent/chat/accounts/<account>/channels/<channel>/workspace/skills
```

Gateway는 각 remote turn 직전에 session resources를 reload합니다. 따라서 새로 생성된 skill이나 수정된 skill은 gateway 프로세스를 재시작하지 않아도 다음 remote turn부터 반영됩니다.

## 원격 명령

채팅방에서는 다음 control command를 사용할 수 있습니다.

```txt
/status
/new
/compact
/stop
/help
```

Telegram에서는 gateway 시작 시 `setMyCommands` API를 호출해 봇 커맨드 메뉴에 등록합니다. 사용자가 `/` 를 입력하면 자동완성 메뉴에 표시됩니다. 등록이 실패해도 gateway 실행은 중단하지 않습니다.

Discord에서는 gateway 시작 시 slash command를 등록하거나 갱신합니다. `serverId`가 있으면 guild command로 등록하고, 없으면 global command 등록을 시도합니다.

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

Slash command 등록이 실패해도 gateway 실행은 중단하지 않고 adapter health의 lastError에 기록합니다. Discord 봇에는 `applications.commands` scope가 필요합니다. Global command는 Discord 쪽 전파가 느릴 수 있으므로, 즉시 테스트할 때는 텍스트 명령 `/status`, `/voice join`도 함께 사용할 수 있습니다.

## Discord Voice Channel

Discord에서는 텍스트 채널에서 voice mode를 켜면 봇이 사용자의 현재 voice channel에 입장해 음성을 듣고, STT 결과를 기존 gateway agent turn으로 전달합니다. Agent 응답은 텍스트 채널에 남고, voice channel에서도 TTS로 재생됩니다.

텍스트 명령:

```txt
/voice join
/voice status
/voice leave
```

Slash command:

```txt
/pie voice join
/pie voice status
/pie voice leave
```

동작 흐름:

```txt
Discord voice channel speech
  -> Opus receive stream
  -> WAV decode
  -> STT
  -> [Voice] transcript posted to text channel
  -> Pie agent turn
  -> text reply to channel
  -> TTS playback to voice channel
```

필요한 Discord 권한:

- Connect
- Speak
- Use Voice Activity
- View Channel / Send Messages / Read Message History
- Message Content Intent

Pie gateway는 Discord client에 `GuildVoiceStates` intent를 함께 사용합니다. 이 intent는 voice channel join과 speaking event 수신에 필요합니다.

관련 의존성:

- `@discordjs/voice`: Discord voice connection, receive, playback
- `prism-media`: Opus decode pipeline
- `opusscript`: received Opus packet decode
- `ffmpeg`: TTS 파일을 Discord voice playback용으로 변환할 때 필요할 수 있음

관련 환경변수:

```bash
PIE_GATEWAY_VOICE_SILENCE_MS=1500          # 발화 종료로 판단할 silence 시간
PIE_GATEWAY_VOICE_MAX_MS=30000             # 한 발화 최대 수신 시간
PIE_GATEWAY_VOICE_MIN_PCM_BYTES=24000      # 너무 짧은 오디오 무시 기준
PIE_GATEWAY_VOICE_PCM_MAX_BYTES=8388608    # PCM decode 최대 크기
PIE_GATEWAY_VOICE_TTS_MAX_CHARS=900        # voice channel TTS로 읽을 최대 글자 수
PIE_GATEWAY_VOICE_JOIN_TIMEOUT_MS=20000
PIE_GATEWAY_VOICE_PLAY_TIMEOUT_MS=10000
```

음성 재생 중에는 수신 처리를 잠시 무시해 봇이 자기 목소리를 다시 받아 처리하지 않도록 합니다. STT/TTS provider가 설정되어 있지 않으면 텍스트 gateway는 계속 동작하지만, 음성 전사나 음성 재생은 실패하거나 건너뛸 수 있습니다.

`pie gateway status`는 pid뿐 아니라 status file, adapter health, queue length, session count도 표시합니다.

`pie gateway doctor`는 다음 항목을 한 번에 점검합니다.

- chat config JSON과 configured account/channel
- gateway pid/status file
- scheduler 설정
- Telegram bot token과 chat 접근성
- Discord bot token, optional guild/channel/home channel, slash command 접근성
- STT 설정, cache, file size limit, local Pie server media route 접근성
- TTS 설정, output directory, text length limit, local Pie server media route 접근성

실패가 있으면 exit code 1을 반환하고, 경고만 있으면 성공으로 종료합니다.

## 대화 내역 조회 CLI

gateway가 수신하고 응답한 채팅 내역은 CLI로 바로 조회할 수 있습니다.

### pie gateway history

특정 채널의 대화 내역을 터미널에 출력합니다.

```bash
# 설정된 채널 목록 확인
pie gateway history

# Telegram DM 최근 50개 (기본값)
pie gateway history dm-donghak-kim

# Discord 채널 최근 20개
pie gateway history channel-1465535874778271823 --limit 20

# 전체 레코드 (checkpoint 포함)
pie gateway history dm-donghak-kim --all
```

출력 예시:

```
[telegram] Pio / donghak kim  (최근 10/107개)
──────────────────────────────────────────────────────────────────────
2026. 5. 27. 12시  donghak: 오늘 날씨 어때?
2026. 5. 27. 12시  AI: 오늘 서울은 흐리고 오전에 비가 내릴 예정입니다...
```

채널 지정은 `accountId/channelKey`, 채널 키, 또는 이름 일부를 허용합니다.

| 옵션 | 설명 |
|------|------|
| `--limit N` | 최근 N개 표시 (기본값: 50) |
| `--all` | checkpoint 등 모든 레코드 포함 |

### pie gateway attach

실행 중인 gateway의 채팅 이벤트를 실시간으로 스트리밍합니다.

```bash
# 전체 채널 실시간 감시
pie gateway attach

# 특정 채널만 감시
pie gateway attach dm-donghak-kim
```

gateway가 메시지를 수신하거나 응답을 보낼 때마다 즉시 터미널에 출력됩니다. `Ctrl+C`로 종료합니다.

내부적으로 `~/.pie/agent/chat/accounts/{accountId}/channels/{channelKey}/channel.jsonl` 파일을 `fs.watch()`로 감시하고, 새로 추가된 라인을 파싱해서 표시합니다.

## Usage 기록

Gateway의 모델 호출은 usage store에 다음 origin/endpoint로 기록됩니다.

```txt
clientOrigin = pie-gateway:<telegram|discord>
endpoint     = pie-gateway:<account>/<channel>
```

Cron 작업은 기존처럼 `pie-cron` origin으로 기록되며, chat에서 만든 작업은 delivery origin으로 원래 conversation id를 유지합니다.

## 기존 bridge와의 관계

| 방식 | 용도 |
|------|------|
| `/chat-connect` | 현재 열린 TUI 세션과 특정 채널을 직접 연결해 테스트하거나 실시간으로 관찰할 때 |
| `/chat-spawn-all` | tmux 기반 legacy long-running worker |
| `pie gateway` | 권장 운영 방식. TUI 없이 장시간 메시지와 cron을 처리 |

앞으로 운영 기준은 `pie gateway`입니다. 기존 bridge extension은 설정 UI와 수동 테스트 경로로 유지합니다.
