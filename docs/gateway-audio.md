# Pie Gateway Audio

`pie gateway`의 오디오 기능은 외부 채팅 채널에서 들어오는 음성 입력을 텍스트로 전사하고, 필요할 때 답변을 음성 파일로 합성해 다시 전송하기 위한 기능입니다.

현재 대상은 Telegram voice note, Discord audio attachment, Discord voice channel입니다.

## 범위 정책

오디오 기능은 Hermes Agent의 STT/TTS/gateway audio 기능을 기준으로만 구현합니다. Pie 전용으로 새로운 provider, 새로운 음성 UX, 새로운 플랫폼 기능을 임의로 추가하지 않습니다.

Hermes에 있는 기능을 Pie 구조에 맞게 옮기는 것은 허용하지만, Hermes에 없는 기능은 오디오 범위에 넣지 않습니다.

Hermes 기준 STT 범위:

```txt
local faster-whisper
local command
Groq Whisper
OpenAI Whisper
Mistral Voxtral Transcribe
xAI Grok STT
managed OpenAI audio gateway
```

Hermes 기준 TTS 범위:

```txt
Edge TTS
ElevenLabs
OpenAI TTS
MiniMax TTS
Mistral Voxtral TTS
Google Gemini TTS
xAI TTS
NeuTTS
KittenTTS
Piper
custom command providers
managed OpenAI audio gateway
```

명시적으로 하지 않는 것:

```txt
Hermes에 없는 audio provider 추가
Hermes에 없는 channel/account별 음성 정책 추가
Hermes에 없는 dashboard 중심 audio workflow 추가
Hermes에 없는 Discord voice UX 확장
```

## 빠른 설정

OpenAI Audio API를 직접 쓰려면 gateway 전용 key를 저장합니다.

```bash
pie gateway audio set
pie gateway audio status
pie gateway audio remove
```

저장 위치는 다음 파일입니다.

```txt
~/.pie/agent/auth.json
```

저장되는 provider id는 `openai-audio`입니다. 이 값은 일반 모델 호출용 `openai` credential과 분리되어 있습니다.

## Credential 해석 순서

STT와 TTS는 같은 OpenAI audio credential resolver를 사용합니다.

```txt
VOICE_TOOLS_OPENAI_KEY
-> ~/.pie/agent/auth.json의 openai-audio
-> OPENAI_API_KEY
-> ~/.pie/agent/provider-connections.json의 openai provider connection
-> ~/.pie/agent/auth.json의 openai
-> local Pie server media route
```

`openai-codex` 로그인은 coding agent provider용 OAuth이므로 OpenAI Audio API key로 취급하지 않습니다.

## STT

음성 입력 전사는 다음 순서로 실행됩니다.

```txt
PIE_GATEWAY_STT_ENDPOINT
-> OpenAI audio transcription
-> local Pie server /v1/audio/transcriptions
```

주요 설정:

```bash
PIE_GATEWAY_STT=0                         # 전사 비활성화
PIE_GATEWAY_STT_ENDPOINT=...              # custom STT endpoint
PIE_GATEWAY_STT_API_KEY=...               # custom endpoint bearer token
PIE_GATEWAY_STT_MODEL=auto:stt            # 기본 model
PIE_GATEWAY_STT_LANGUAGE=ko               # 기본 언어
PIE_GATEWAY_STT_PROMPT=...                # 전사 prompt
PIE_GATEWAY_STT_TIMEOUT_MS=20000
PIE_GATEWAY_STT_CACHE=0                   # 전사 cache 비활성화
PIE_GATEWAY_STT_CACHE_DIR=...
PIE_GATEWAY_STT_MAX_BYTES=25mb
```

전사 결과는 audio hash와 STT 설정을 기준으로 cache됩니다. 같은 음성 파일과 같은 설정이면 provider를 다시 호출하지 않습니다.

## TTS

음성 응답 합성은 agent가 `chat_voice` tool을 사용할 때 실행됩니다.

```txt
PIE_GATEWAY_TTS_ENDPOINT
-> OpenAI audio speech
-> local Pie server /v1/audio/speech
```

주요 설정:

```bash
PIE_GATEWAY_TTS=0                         # 음성 응답 비활성화
PIE_GATEWAY_TTS_ENDPOINT=...              # custom TTS endpoint
PIE_GATEWAY_TTS_API_KEY=...               # custom endpoint bearer token
PIE_GATEWAY_TTS_MODEL=auto:tts            # 기본 model
PIE_GATEWAY_TTS_VOICE=alloy               # 기본 voice
PIE_GATEWAY_TTS_FORMAT=mp3
PIE_GATEWAY_TTS_TIMEOUT_MS=30000
PIE_GATEWAY_TTS_MAX_CHARS=2000
PIE_GATEWAY_TTS_DIR=...                   # 기본 ~/.pie/agent/gateway/tts
```

TTS provider가 없거나 실패해도 gateway turn은 실패하지 않고 텍스트 응답을 계속 전송합니다.

## Discord Voice

Discord voice channel은 텍스트 채널에서 다음 명령으로 제어합니다.

```txt
/voice join
/voice status
/voice leave
```

또는 slash command를 사용할 수 있습니다.

```txt
/pie voice join
/pie voice status
/pie voice leave
```

기본 흐름:

```txt
Discord voice speech
-> Opus receive stream
-> WAV decode
-> STT
-> Pie agent turn
-> text reply
-> optional TTS playback
```

Discord voice에는 `Connect`, `Speak`, `Use Voice Activity`, `View Channel`, `Send Messages`, `Read Message History`, `Message Content Intent`가 필요합니다.

## Doctor 확인

설정 후 다음 명령으로 확인합니다.

```bash
pie gateway audio status
pie gateway doctor
```

`pie gateway doctor`에서 STT/TTS 경고가 보여도 텍스트 Telegram/Discord 응답은 동작할 수 있습니다. 경고는 음성 전사 또는 음성 응답을 위한 provider가 준비되지 않았다는 뜻입니다.

## 테스트 순서

1. `pie gateway audio set`으로 OpenAI audio key를 저장합니다.
2. `pie gateway audio status`에서 `auth.json openai-audio`가 표시되는지 확인합니다.
3. `pie gateway doctor`에서 STT/TTS 경고가 사라지는지 확인합니다.
4. `pie gateway run` 또는 `pie gateway restart`로 gateway를 실행합니다.
5. Telegram에서 voice note를 보내 전사 결과가 agent 입력에 들어가는지 확인합니다.
6. Discord에서 audio attachment를 보내 전사 결과가 agent 입력에 들어가는지 확인합니다.
7. Discord voice channel에서 `/voice join` 후 짧게 말하고, 텍스트 응답과 TTS playback을 확인합니다.

## 남은 작업

오디오 기능은 기본 경로가 구현되어 있지만, Hermes parity 기준으로 다음 작업이 남아 있습니다.

- 실제 Telegram voice note, Discord audio attachment, Discord voice channel 기준 end-to-end 회귀 테스트
- Hermes STT provider parity: local faster-whisper/local command, Groq, Mistral, xAI
- Hermes TTS provider parity: Edge, ElevenLabs, MiniMax, Mistral, Gemini, xAI, NeuTTS, KittenTTS, Piper, custom command
- Hermes 방식의 setup/config 흐름과 Pie `pie gateway audio` 흐름 정합성 검증
- managed OpenAI audio gateway에 해당하는 Pie 경로가 필요한지 Hermes 기준으로만 판단
- Discord voice playback 안정화: ffmpeg 감지, format 변환, 긴 응답 처리
- STT cache 정리와 cache 크기 제한. Hermes에 있는 동작과 맞출 수 있는 범위까지만 구현
- direct OpenAI STT/TTS 호출의 usage/cost 기록 연결. 이는 Pie 운영 기록을 위한 통합 작업이며, audio provider 범위 확장이 아닙니다.
