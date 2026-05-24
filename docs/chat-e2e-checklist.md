# pie-chat E2E 검증 체크리스트

이 문서는 `apps/chat`의 Telegram/Discord bridge가 실제 채널에서 안정적으로 동작하는지 확인하기 위한 체크리스트입니다. 사용법은 [chat-usage.md](./chat-usage.md)를 기준으로 하고, 이 문서는 통과 기준과 관찰 지점을 정리합니다.

## 검증 목표

`pie-chat` 검증의 핵심은 외부 채팅 메시지가 `pie` agent session으로 들어오고, 응답이 다시 같은 채널로 돌아가며, 해당 LLM 호출이 `pie-lab-router`를 통과하는지 확인하는 것입니다.

```txt
Telegram/Discord
  -> apps/chat bridge
  -> pie agent session
  -> pie-lab-router
  -> provider engine
  -> Telegram/Discord reply
```

## 사전 준비

- Node.js는 repository 기준 버전인 `22.19.0` 이상을 사용합니다.
- `npm install`이 완료되어 있어야 합니다.
- `pie` 또는 `./pie-test.sh`로 CLI를 실행할 수 있어야 합니다.
- 최소 하나 이상의 provider 인증이 설정되어 있어야 합니다.
- routing policy에서 `auto:chat`이 실제 사용 가능한 모델로 resolve되어야 합니다.

확인 명령:

```bash
npm --workspace @pie-lab/pie-chat run check:bridge
npm --workspace @pie-lab/pie-chat run lint
npm --workspace @pie-lab/pie-chat run build
```

## 공통 로컬 확인

1. bridge extension을 실행합니다.

```bash
pie
```

프로젝트 설정을 우회해 임시로 확인할 때는 다음처럼 명시적으로 로드할 수도 있습니다.

```bash
pie -e apps/chat
./pie-test.sh -e apps/chat
```

2. TUI에서 명령이 등록되어 있는지 확인합니다.

```txt
/chat-config
/chat-list
/chat-connect
/chat-status
/chat-workers
```

3. 저장 경로가 `~/.pie/agent/chat`인지 확인합니다.

```bash
find ~/.pie/agent/chat -maxdepth 4 -type f | sort
```

## Telegram DM 검증

통과 기준:

- `/chat-config`에서 Telegram account를 만들 수 있습니다.
- BotFather token으로 bot 연결이 됩니다.
- 사용자가 Telegram에서 bot에게 `/start`를 보낸 뒤 DM 대상이 감지됩니다.
- `/chat-connect <account>/<channel>` 후 Telegram 메시지를 보내면 `pie` agent turn이 시작됩니다.
- agent 최종 응답이 Telegram DM으로 돌아옵니다.
- `channel.jsonl`에 inbound, job queued, job completed 또는 failed 기록이 남습니다.

확인할 메시지:

```txt
안녕. 지금 어떤 모델로 응답하고 있는지 짧게 알려줘.
```

확인 명령:

```txt
/chat-status
```

```bash
tail -n 80 ~/.pie/agent/chat/accounts/<account>/channels/<channel>/channel.jsonl
```

## Discord 채널 검증

통과 기준:

- Discord Developer Portal에서 Message Content Intent가 켜져 있습니다.
- bot이 대상 서버와 채널에 초대되어 있습니다.
- bot이 메시지를 읽고 보낼 권한을 가집니다.
- 일반 채널에서는 bot mention으로 trigger됩니다.
- agent 최종 응답이 같은 Discord channel로 돌아옵니다.

확인할 메시지:

```txt
@bot status
```

그 다음:

```txt
@bot 지금 이 채널에서 작업할 수 있는지 한 문장으로 답해줘.
```

## worker 검증

여러 채널을 계속 연결할 때는 tmux worker를 확인합니다.

```txt
/chat-spawn-all
/chat-workers
/chat-open-all
```

통과 기준:

- 각 configured channel마다 `pie-chat-worker-*` tmux session이 생성됩니다.
- `/chat-workers`에서 queue 상태와 model 정보가 표시됩니다.
- worker를 종료하면 `/chat-kill-all`이 정상적으로 session을 정리합니다.

## 원격 명령 검증

외부 채팅에서 아래 명령을 보냅니다.

```txt
status
compact
new
stop
```

통과 기준:

- `status`는 모델, 사용량, context 상태를 반환합니다.
- `compact`는 compaction을 요청하고 완료/실패 상태를 채팅으로 알려줍니다.
- `new`는 새 `pie` session을 시작합니다.
- `stop`은 실행 중인 agent turn을 중단합니다.

## 라우팅과 사용량 확인

원격 채팅 응답 후 usage record를 확인합니다.

```bash
curl -sS "http://127.0.0.1:4873/usage?limit=20" | jq
curl -sS "http://127.0.0.1:4873/usage/summary" | jq
```

확인할 항목:

- `requestedModel`
- `resolvedProvider`
- `resolvedModel`
- `routingMode`
- `connectionId`
- `endpoint`
- `cost`
- `status`

현재 1차 기준에서는 원격 채팅에서 발생한 agent turn도 내부 `coding-agent` routed stream usage record로 남습니다. 다음 고도화 단계에서는 `chat` origin, account, channel 정보를 dashboard에서 더 명확하게 구분하도록 확장합니다.

## 첨부파일 검증

Telegram/Discord에서 작은 텍스트 파일이나 이미지를 보냅니다.

통과 기준:

- 파일이 `/workspace/incoming` 아래로 materialize됩니다.
- agent가 필요한 경우 `read`, `bash`, `chat_attach` 도구를 사용할 수 있습니다.
- agent가 `chat_attach`로 지정한 파일은 다음 remote reply와 함께 전송됩니다.

확인 경로:

```bash
find ~/.pie/agent/chat/accounts/<account>/channels/<channel>/workspace/incoming -maxdepth 2 -type f
```

## 실패 시 우선 확인

- 터미널에서 직접 입력한 메시지는 Telegram/Discord로 돌아가지 않습니다.
- Telegram bot에게 `/start`를 보냈는지 확인합니다.
- Discord Message Content Intent와 channel permission을 확인합니다.
- `/chat-status`에서 bridge가 connected인지 확인합니다.
- worker 방식이면 `/chat-workers`에서 session이 살아 있는지 확인합니다.
- `channel.jsonl`의 마지막 `job_failed` 또는 send error를 확인합니다.

## 완료 기준

아래 조건을 모두 만족하면 `pie-chat` bridge 1차 E2E 검증 완료로 봅니다.

- Telegram DM에서 5회 이상 연속 왕복 대화 성공
- Discord channel에서 mention 기반 5회 이상 연속 왕복 대화 성공
- `status`, `new`, `compact`, `stop` 원격 명령 동작 확인
- 첨부파일 수신과 `chat_attach` 송신 확인
- 각 요청이 router를 거친 usage record로 남는 것 확인
- 실패 상황이 생겼을 때 `channel.jsonl`, `/chat-status`, `/chat-workers`로 원인을 추적할 수 있음
