# Discord Gateway Setup

이 문서는 Discord bot을 만들고 `pie gateway`에 연결해, Discord 채널이나 DM에서 Pie agent를 호출하는 과정을 정리합니다.

권장 운영 방식은 `/chat-connect`가 아니라 `pie gateway`입니다. `pie gateway`는 TUI 세션을 계속 열어두지 않아도 Discord 메시지를 받고, 같은 프로세스에서 scheduler cron delivery도 처리합니다.

## 전체 흐름

```txt
Discord Developer Portal에서 application/bot 생성
  -> bot token 복사
  -> Message Content Intent 활성화
  -> bot을 서버에 초대
  -> pie gateway setup에서 token 저장
  -> pie gateway run 또는 install
  -> Discord에서 @bot 메시지로 테스트
```

## 1. Discord Application 만들기

1. Discord Developer Portal로 이동합니다.
2. `New Application`을 선택하고 이름을 정합니다. 예: `PIE-LAB`
3. 왼쪽 메뉴에서 `Bot`으로 이동합니다.
4. `Reset Token` 또는 `Copy Token`으로 bot token을 준비합니다.

Bot token은 비밀번호와 같습니다. Git, 문서, 채팅방에 노출하지 말고 `pie gateway setup`에만 입력하세요.

참고:

- Discord OAuth2와 bot token 개념: <https://docs.discord.com/developers/platform/oauth2-and-permissions>
- Discord getting started: <https://docs.discord.com/developers/docs/getting-started>

## 2. Privileged Intent 켜기

Discord Developer Portal의 bot 설정에서 다음 intent를 켭니다.

```txt
Message Content Intent
```

Pie gateway는 일반 텍스트 채널에서 `@PIE-LAB 안녕` 같은 메시지를 읽어야 하므로 Message Content Intent가 필요합니다. 이 intent가 꺼져 있으면 Discord API에서 메시지 `content`가 비어 보일 수 있고, bot이 연결되어 있어도 응답하지 않는 것처럼 보일 수 있습니다.

참고:

- Discord Gateway intents: <https://docs.discord.com/developers/topics/gateway>
- Discord message content 제한: <https://docs.discord.com/developers/resources/message>
- Privileged intents 설명: <https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents>

## 3. Bot을 서버에 초대하기

Developer Portal에서 `OAuth2` 또는 `Installation` 설정으로 이동해 bot 초대 URL을 만듭니다.

필수 scope:

```txt
bot
applications.commands
```

권장 bot permissions:

```txt
View Channels
Send Messages
Read Message History
Attach Files
Connect
Speak
Use Voice Activity
```

텍스트 응답만 쓸 경우 `Connect`, `Speak`, `Use Voice Activity`는 없어도 됩니다. Discord voice mode까지 쓸 계획이라면 함께 부여하는 편이 좋습니다.

초대 후에는 대상 채널에서 bot이 실제로 `View Channel`, `Send Messages`, `Read Message History` 권한을 갖는지 확인하세요. 서버 권한이 있어도 채널별 권한에서 막히면 응답하지 못합니다.

## 4. Pie에 Discord Token 저장하기

저장소 checkout에서 개발 중이라면 먼저 빌드된 CLI 또는 링크된 `pie`가 최신인지 확인합니다.

```bash
npm run build --workspace=@pie-lab/coding-agent
```

그다음 gateway setup을 실행합니다.

```bash
pie gateway setup
```

프롬프트는 다음처럼 진행합니다.

```txt
Add service: telegram, discord, or done (done): discord
Discord bot token: <Discord Developer Portal에서 복사한 token>
Add service: telegram, discord, or done (done): done
```

현재 Discord setup은 Hermes 방식에 맞춰 bot token만 입력합니다. account id, server id, channel id를 미리 넣지 않아도 됩니다.

설정은 아래 파일에 저장됩니다.

```txt
~/.pie/agent/chat/config.json
```

## 5. Gateway 실행하기

개발 중에는 foreground 실행이 가장 이해하기 쉽습니다.

```bash
pie gateway run
```

다른 터미널에서 상태를 확인합니다.

```bash
pie gateway status
pie gateway doctor
```

장시간 운영하려면 OS 사용자 서비스로 설치합니다.

```bash
pie gateway install
pie gateway status
```

설정이나 코드 변경 후 서비스 재시작:

```bash
pie gateway restart
```

만약 `Could not find service "ai.pielab.gateway"` 같은 메시지가 보이면 아직 서비스가 설치되지 않은 상태입니다. 이 경우 먼저 `pie gateway install`을 실행하거나, 테스트용으로 `pie gateway run`을 사용하면 됩니다.

## 6. Discord에서 테스트하기

Discord 서버 채널에서 bot을 멘션합니다.

```txt
@PIE-LAB 안녕
```

정상이라면 같은 채널에 Pie 응답이 돌아옵니다.

처음 호출된 Discord 채널은 자동으로 설정에 저장됩니다.

```json
{
  "channels": {
    "channel-1465535874778271823": {
      "id": "1465535874778271823",
      "name": "일반",
      "dm": false,
      "autoDiscovered": true,
      "access": {
        "ignoreBots": true,
        "trigger": "mention"
      }
    }
  }
}
```

상태 확인에서는 다음처럼 보입니다.

```txt
running pid=...
adapters:
- discord (discord) connected errors=0
- discord/channel-... (discord) PIE-LAB / 일반 queue=0 sessions=1
```

Discord에서 bot 사용자 멘션 대신 bot 이름과 같은 role mention이 만들어지는 경우도 있습니다. Pie gateway는 `PIE-LAB` 같은 matching role mention도 bot 호출로 처리합니다.

## 7. Slash Command와 원격 명령

Gateway 시작 시 Discord slash command 등록을 시도합니다.

```txt
/pie status
/pie new
/pie compact
/pie stop
/pie help
/pie voice join
/pie voice status
/pie voice leave
```

`serverId`가 없으면 global command로 등록됩니다. Discord global command는 반영에 시간이 걸릴 수 있으니, 즉시 테스트할 때는 텍스트 멘션을 먼저 사용하세요.

채팅방에서는 텍스트 원격 명령도 사용할 수 있습니다.

```txt
/status
/new
/compact
/stop
/help
```

일반 서버 채널에서는 기본적으로 bot mention이 trigger입니다. DM에서는 모든 메시지가 trigger입니다.

## 8. 문제 해결

### Gateway는 connected인데 응답이 없을 때

먼저 상태와 doctor를 봅니다.

```bash
pie gateway status
pie gateway doctor
```

확인할 항목:

- `discord (discord) connected errors=0`인지 확인합니다.
- Discord Developer Portal에서 `Message Content Intent`가 켜져 있는지 확인합니다.
- bot이 대상 채널의 `View Channel`, `Send Messages`, `Read Message History` 권한을 갖는지 확인합니다.
- 서버 채널에서는 `@PIE-LAB`처럼 bot을 멘션했는지 확인합니다.
- 오래된 gateway 프로세스가 떠 있다면 `pie gateway stop` 후 `pie gateway run`으로 다시 시작합니다.

### 채널이 자동 생성됐는지 확인하기

설정 파일에서 Discord channel이 생겼는지 봅니다.

```bash
cat ~/.pie/agent/chat/config.json
```

대화 로그는 채널별로 저장됩니다.

```txt
~/.pie/agent/chat/accounts/<discord-account>/channels/<channel-key>/channel.jsonl
```

`inbound`, `job_queued`, `outbound`, `job_completed`가 순서대로 기록되면 Discord 메시지가 Pie agent turn으로 정상 처리된 것입니다.

### STT/TTS 경고가 보일 때

`pie gateway doctor`에서 STT/TTS 경고가 보여도 텍스트 Discord 응답은 동작할 수 있습니다. 음성 전사나 음성 응답까지 쓰려면 gateway audio key, OpenAI provider connection, `VOICE_TOOLS_OPENAI_KEY`, `OPENAI_API_KEY`, 또는 local Pie server media route 중 하나를 준비하면 됩니다.

OpenAI key를 매번 export하지 않아도 됩니다. Gateway 전용 키는 아래 명령으로 저장합니다.

```bash
pie gateway audio set
pie gateway audio status
pie gateway audio remove
```

dashboard의 Providers 화면이나 `/login` 흐름으로 저장된 `openai` 연결도 fallback으로 읽습니다. `openai-codex` 로그인은 coding agent provider용이라 OpenAI audio API key로 취급하지 않습니다.

```txt
~/.pie/agent/auth.json                    # openai-audio 또는 openai credential
~/.pie/agent/provider-connections.json
```

### 기존 `/chat-connect`와 차이

`/chat-connect`는 열린 `pie` TUI 세션에 채널을 붙이는 테스트용 경로입니다. TUI를 닫으면 연결도 끊깁니다.

`pie gateway`는 독립 프로세스입니다. 운영 기준은 다음처럼 잡으면 됩니다.

```txt
설정: pie gateway setup
개발 테스트: pie gateway run
상시 운영: pie gateway install
상태 점검: pie gateway status / pie gateway doctor
```
