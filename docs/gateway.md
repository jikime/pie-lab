# Pie Gateway

`pie gateway`는 Telegram/Discord 메시지와 cron scheduled automation을 장시간 처리하기 위한 독립 실행 프로세스입니다.

기존 `/chat-connect` 방식은 열린 `pie` TUI 세션 하나에 특정 채널을 붙이는 구조입니다. 이 방식은 빠른 테스트에는 편하지만, 세션을 종료하면 연결도 끊어집니다. 반면 `pie gateway`는 별도 프로세스로 실행되며, TUI를 열어 두지 않아도 메시지를 받고 응답하며 cron tick도 함께 처리합니다.

## 실행 방식

```bash
pie gateway setup
pie gateway run
```

상태 확인과 종료:

```bash
pie gateway status
pie gateway stop
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

## 동작 구조

```txt
Telegram/Discord message
  -> pie gateway account adapter
  -> conversation runtime log
  -> Pie agent session
  -> router + learning loop + skills + tools
  -> Markdown-rendered reply to Telegram/Discord
```

Telegram은 bot token당 하나의 polling loop만 사용합니다. Discord도 account당 하나의 `discord.js` client만 사용합니다. 이렇게 해야 여러 채널을 연결했을 때 같은 계정의 update cursor가 서로 충돌하지 않습니다.

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
