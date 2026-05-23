# pie-lab 같이 이야기해보실 분 계실까요?

요즘 `pi`, `9router`, `pie-chat`이라는 프로젝트들을 보면서, 이걸 잘 엮으면 꽤 재미있는 걸 만들 수 있겠다는 생각을 하고 있습니다.

통합해서 만들 가칭 `pie-lab`에서의 `pi`는 Passive Income의 약자, 한국어로는 흔히 말하는 “불로소득”에 가까운 의미로 생각하고 있습니다. AI 도구와 agent를 잘 활용해서 반복되는 작업을 줄이고, 작은 자동화 자산을 쌓아가는 방향도 함께 담아보고 싶습니다.

아직 이름은 가칭이지만, `pie-lab`라는 형태로 생각하고 있어요.

거창하게 큰 플랫폼을 만들겠다는 것보다는, 일단 각 프로젝트가 가진 장점을 활용해서 AI agent 개발이나 AI tool routing, 그리고 Discord/Telegram 같은 채팅 채널 연동에 쓸 수 있는 작은 개발 키트를 만들어보면 어떨까 합니다.

대략적인 생각은 이렇습니다.

- `pi` 쪽의 멀티 LLM provider 호출 구조를 활용하고
- `9router` 쪽의 router, dashboard, CLI, provider 관리 기능을 활용해서
- `pie-chat` 쪽의 Discord/Telegram chat bridge 경험도 나중에 연결해서
- 로컬에서 AI 도구나 agent를 좀 더 편하게 만들고 실행할 수 있는 형태로 정리해보려 합니다.

예를 들면 나중에는 이런 식의 흐름을 생각하고 있습니다.

```bash
pie start
```

명령으로 로컬 서버와 dashboard를 띄우고,

```txt
http://localhost:20128/v1
```

같은 endpoint에 Codex, Claude Code, Cursor, Cline 같은 도구를 연결하거나, 간단한 agent를 실행해보는 식입니다. 이후에는 Discord나 Telegram 같은 채팅 채널에서 agent를 부르는 흐름도 생각해볼 수 있을 것 같습니다.

아직 구체적인 구조나 방향은 확정하지 않았습니다.
그래서 처음부터 바로 개발에 들어가기보다는, 관심 있는 분들과 온라인이나 오프라인으로 한번 만나서 이런 이야기를 나눠보고 싶습니다.

- 이걸 어떤 방향으로 만들면 좋을지
- `pi`와 `9router`를 어느 정도까지 통합하면 좋을지
- `pie-chat`은 어느 단계에서 어떤 범위로 붙이면 좋을지
- 실제로 사람들이 쓸 만한 기능은 무엇일지
- 처음 MVP는 어디까지 잡으면 좋을지
- 각자 관심 있는 역할이 있을지

이런 부분을 가볍게 논의해보면 좋겠습니다.

TypeScript, Node.js, LLM provider, AI coding tool, router, dashboard, CLI, agent 개발, Discord/Telegram bot 연동 쪽에 관심 있는 분이면 편하게 의견 주셔도 좋습니다. 꼭 깊은 경험이 없어도 괜찮고, 그냥 “이런 거 있으면 써보고 싶다” 정도의 의견도 좋습니다.

관심 있으신 분들은 댓글 남겨주세요.
어느 정도 사람이 모이면 온라인 미팅이나 오프라인 모임을 잡아서 향후 진행 방향을 같이 이야기해보겠습니다.
