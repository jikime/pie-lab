# pie-chat 사용법

`pie-chat`은 두 가지 채팅 경로를 제공합니다.

1. 웹 브라우저에서 사용하는 Pie Chat UI
2. Telegram 또는 Discord 메시지를 `pie` agent session에 연결하는 chat bridge

두 경로는 목적이 다릅니다. 웹 채팅은 브라우저에서 직접 대화하는 용도이고, Telegram/Discord bridge는 외부 채팅방의 메시지를 `pie` 세션으로 가져와 처리한 뒤 다시 외부 채팅방으로 응답하는 용도입니다.

## 웹 채팅 실행

먼저 pie-lab API server를 실행합니다.

```bash
npm --workspace @pie-lab/server run dev
```

다른 터미널에서 Pie Chat 웹 앱을 실행합니다.

```bash
npm --workspace @pie-lab/pie-chat run dev
```

기본 주소는 다음과 같습니다.

```txt
Pie Chat: http://127.0.0.1:4877
API server: http://127.0.0.1:4873
```

웹 채팅의 기본 모델은 `auto:chat`입니다. 현재 권장 라우팅 정책은 다음 순서입니다.

```txt
google/gemini-3.1-pro-preview
google/gemini-2.5-flash
```

웹 채팅 요청은 API server로 전달될 때 `clientOrigin=pie-chat:web`으로 usage record에 저장됩니다. dashboard-next의 `Usage -> Origins` 탭에서 웹 채팅 비용과 CLI/bridge 비용을 분리해서 볼 수 있습니다.

## Telegram/Discord Bridge 실행

Telegram/Discord bridge는 Next.js 웹 서버가 아니라 `pie` extension으로 실행합니다.

```bash
pie -e apps/chat
```

소스에서 바로 테스트할 때는 저장소 루트에서 다음처럼 실행할 수도 있습니다.

```bash
./pie-test.sh -e apps/chat
```

실행 후 `pie` TUI 안에서 아래 명령을 사용합니다.

```txt
/chat-config
```

`/chat-config`에서 Telegram 또는 Discord 계정을 만들고 채널을 등록합니다.

## Telegram 설정

1. Telegram에서 `@BotFather`로 새 bot을 만듭니다.
2. 발급받은 bot token을 복사합니다.
3. `pie -e apps/chat` 실행 후 `/chat-config`를 입력합니다.
4. `Create account`에서 `Telegram`을 선택합니다.
5. bot token을 입력합니다.
6. DM을 연결하려면 `Add DM`을 선택합니다.
7. Telegram에서 해당 bot에게 `/start`를 보냅니다.
8. TUI가 감지한 DM 대상을 선택해 저장합니다.

등록된 설정은 로컬에 저장됩니다.

```txt
~/.pie/agent/chat/config.json
```

## Discord 설정

1. Discord Developer Portal에서 bot application을 만듭니다.
2. Bot 설정에서 Message Content Intent를 활성화합니다.
3. `pie -e apps/chat` 실행 후 `/chat-config`를 입력합니다.
4. `Create account`에서 `Discord`를 선택합니다.
5. Discord bot token을 입력합니다.
6. 안내되는 invite URL로 bot을 서버에 초대합니다.
7. 서버와 채널을 선택해 저장합니다.

## 채널 연결

채널을 등록한 것만으로는 메시지를 처리하지 않습니다. 반드시 연결해야 합니다.

현재 `pie` 세션 하나를 특정 채널에 연결하려면 다음을 사용합니다.

```txt
/chat-connect
```

또는 대상이 확실하면 직접 지정할 수 있습니다.

```txt
/chat-connect telegram-pio/dm-donghak-kim
```

여러 채널을 계속 켜두려면 tmux worker를 띄웁니다.

```txt
/chat-spawn-all
```

worker 상태는 다음으로 확인합니다.

```txt
/chat-workers
```

실행 중인 worker를 한 화면에 열려면 다음을 사용합니다.

```txt
/chat-open-all
```

worker를 모두 종료하려면 다음을 사용합니다.

```txt
/chat-kill-all
```

## 대화 흐름

Telegram/Discord에서 메시지를 보내면 bridge가 메시지를 가져오고, `pie` 세션에 agent 요청을 넣습니다. agent 응답이 끝나면 bridge가 그 최종 응답을 다시 Telegram/Discord로 보냅니다.

```txt
Telegram/Discord 메시지
  -> pie-chat live adapter
  -> pie agent session
  -> agent 응답 생성
  -> Telegram/Discord로 전송
```

중요한 점은, 터미널에 직접 입력한 메시지는 로컬 `pie` 대화입니다. 이 경우 응답은 터미널에만 표시되고 Telegram/Discord로 자동 전송되지 않습니다.

Telegram/Discord로 응답을 보내려면 메시지가 반드시 원격 채팅에서 들어온 턴이어야 합니다.

bridge worker에서 발생한 모델 호출은 `clientOrigin=pie-chat:telegram` 또는 `clientOrigin=pie-chat:discord`로 usage record에 저장됩니다. 따라서 같은 모델을 사용해도 웹 채팅, Telegram, Discord, 일반 CLI 비용을 dashboard-next에서 구분할 수 있습니다.

## 자주 쓰는 명령

| 명령 | 용도 |
|------|------|
| `/chat-config` | Telegram/Discord 계정과 채널 설정 |
| `/chat-connect` | 현재 `pie` 세션을 채널에 연결 |
| `/chat-disconnect` | 현재 채널 연결 해제 |
| `/chat-status` | 연결 상태, 모델, 사용량, queue 상태 확인 |
| `/chat-list` | 등록된 채널 목록 확인 |
| `/chat-spawn-all` | 등록된 모든 채널을 tmux worker로 실행 |
| `/chat-workers` | worker 상태 확인 |
| `/chat-open-all` | 실행 중인 worker를 tmux dashboard로 열기 |
| `/chat-kill-all` | pie-chat worker 모두 종료 |
| `/chat-new` | 현재 chat 연결을 유지하면서 새 `pie` session 시작 |

## 원격 채팅 명령

Telegram/Discord 사용자는 채팅방에서 다음 명령을 보낼 수 있습니다.

| 명령 | 효과 |
|------|------|
| `status` | 모델, 사용량, context 상태 확인 |
| `stop` | 현재 agent turn 중단 |
| `compact` | context compaction 실행 |
| `new` | 새 `pie` session 시작 |

DM에서는 모든 메시지가 trigger가 됩니다. 일반 채널에서는 기본적으로 bot mention이 trigger입니다.

## 파일과 메모리

각 연결 채널은 별도의 workspace를 가집니다.

```txt
~/.pie/agent/chat/
├── config.json
├── cache/
└── accounts/<account>/
    ├── shared/
    │   ├── memory.md
    │   └── skills/
    └── channels/<channel>/
        ├── channel.jsonl
        ├── workspace/
        │   ├── memory.md
        │   ├── skills/
        │   └── incoming/
        └── gondolin/
```

메모리는 두 단계로 나뉩니다.

| 파일 | 범위 |
|------|------|
| `/shared/memory.md` | 같은 account의 모든 채널에서 공유 |
| `/workspace/memory.md` | 현재 채널에서만 사용 |

첨부파일은 `/workspace/incoming` 아래에 저장되고, agent는 필요한 경우 `read`, `bash`, `chat_attach` 도구를 사용합니다.

## 응답이 Telegram/Discord에 보이지 않을 때

먼저 메시지가 어디에서 시작됐는지 확인합니다.

- 터미널에 직접 입력했다면 정상적으로 터미널에만 표시됩니다.
- Telegram/Discord에서 보낸 메시지라면 agent 응답 완료 후 원격 채팅으로 전송되어야 합니다.

확인 순서는 다음과 같습니다.

1. bridge가 연결되어 있는지 확인합니다.

```txt
/chat-status
```

2. worker 방식이면 worker가 떠 있는지 확인합니다.

```txt
/chat-workers
```

3. Telegram/Discord에서 새 메시지를 다시 보냅니다. `/chat-connect` 전에 보낸 메시지는 catch-up 처리될 수 있지만, 연결 완료 후 새 메시지로 확인하는 편이 안전합니다.

4. 채널 로그를 확인합니다.

```bash
find ~/.pie/agent/chat -name channel.jsonl -print
tail -n 50 ~/.pie/agent/chat/accounts/<account>/channels/<channel>/channel.jsonl
```

5. `send failed`, `timed out`, `Forbidden`, `Bad Request` 같은 오류가 있는지 봅니다.

Telegram에서 자주 생기는 원인은 다음과 같습니다.

- bot에게 `/start`를 보내지 않았습니다.
- 사용자가 bot을 차단했습니다.
- bridge가 연결되지 않았습니다.
- 터미널에서 직접 대화하고 있어 remote chat turn이 아닙니다.
- Telegram API send 단계에서 오류가 났지만 TUI 상태를 확인하지 않았습니다.

Discord에서 자주 생기는 원인은 다음과 같습니다.

- Message Content Intent가 꺼져 있습니다.
- bot이 채널을 읽거나 메시지를 보낼 권한이 없습니다.
- mention trigger가 필요한 채널에서 bot을 mention하지 않았습니다.
- bridge worker가 실행 중이 아닙니다.

## 현재 구현 기준

현재 `pie-chat` bridge는 기존 `pi-chat` 기능을 `apps/chat/extension` 아래로 이식한 상태입니다.

- extension entry: `apps/chat/extension/index.ts`
- 저장 경로: `~/.pie/agent/chat`
- worker 실행 명령: `pie`
- 웹 채팅 앱: `apps/chat/src`
- usage origin: `pie-chat:web`, `pie-chat:telegram`, `pie-chat:discord`

웹 채팅과 Telegram/Discord bridge는 같은 `apps/chat`에 있지만 실행 방식은 다릅니다. 웹 채팅은 Next.js 서버로 실행하고, Telegram/Discord bridge는 `pie -e apps/chat`로 실행합니다.
