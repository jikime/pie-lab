# Pie Learning Loop

이 문서는 Pie에 추가한 Learning Loop의 현재 구현 범위와 운영 방식을 정리합니다.

## 목표

Learning Loop는 한 번 해결한 문제, 반복되는 사용자 선호, 자주 쓰는 작업 절차를 다음 세션에서도 재사용할 수 있게 만드는 기능입니다.

현재 흐름은 다음을 기준으로 합니다.

```txt
사용자 요청
→ Local Memory + Skill Index 주입
→ pie agent 작업 수행
→ 응답 완료
→ background learning review 실행
→ memory 저장 / skill 생성·수정
→ 다음 요청에서 재사용
```

v1 범위는 다음 두 가지입니다.

- Persistent Memory
- Skill Creation + LLM-driven Curator Consolidation

스킬은 자동 저장을 기본값으로 둡니다. 모든 데이터는 로컬 파일로만 저장됩니다.

## 저장 위치

전역 agent 데이터는 `~/.pie/agent` 아래에 저장합니다.

```txt
~/.pie/agent/
  memories/
    MEMORY.md
    USER.md
  skills/
    <skill>/
      SKILL.md
      .usage.json
    .archive/
    .backups/
    .curator_state
```

프로젝트 전용 스킬은 기존 방식대로 `.pie/skills`를 사용합니다.

```txt
<project>/
  .pie/
    skills/
```

## Persistent Memory

구현 파일:

- `packages/coding-agent/src/core/learning/memory-store.ts`

메모리는 두 파일로 나눕니다.

- `MEMORY.md`: 프로젝트, 환경, 반복되는 사실, 결정사항, 도구 사용 패턴
- `USER.md`: 사용자 선호, 말투, 작업 방식, 반복 교정 사항

세션 시작 시 현재 파일 내용을 frozen snapshot으로 system prompt에 주입합니다. 세션 중 memory tool이 파일을 바꿔도 현재 system prompt는 즉시 흔들지 않고, 다음 세션이나 reload 이후에 반영합니다.

prompt injection성 문구는 저장 단계에서 차단합니다.

## Skill Creation

구현 파일:

- `packages/coding-agent/src/core/learning/skill-manager.ts`
- `packages/coding-agent/src/core/learning/tools.ts`
- `packages/coding-agent/src/core/learning/background-review.ts`

Learning Loop가 제공하는 tool surface는 다음입니다.

- `memory`
- `skills_list`
- `skill_view`
- `skill_manage`

`skill_manage`는 다음 동작을 지원합니다.

- `create`
- `patch`
- `edit`
- `delete` / `archive`
- `write_file`
- `remove_file`

자동 생성 기준은 다음처럼 잡았습니다.

- 복잡한 작업을 해결했을 때
- 반복 가능한 절차를 발견했을 때
- 사용자가 workflow나 style을 교정했을 때
- 기존 skill이 부정확하거나 누락된 절차가 드러났을 때

스킬 이름은 session-specific 이름이 아니라 class-level 이름이어야 합니다.

좋은 예:

```txt
router-integration-debugging
nextjs-dashboard-migration
```

피해야 할 예:

```txt
fix-gemini-error-today
2026-05-24-router-bug
```

agent가 만든 스킬에는 `.usage.json`이 함께 기록됩니다. 이 값은 curator가 자동 관리 대상을 구분하는 기준입니다.

## Background Review

구현 파일:

- `packages/coding-agent/src/core/learning/background-review.ts`
- `packages/coding-agent/src/core/agent-session.ts`

assistant 응답이 끝난 뒤 `agent_end` 시점에 background review를 실행합니다. 이 review는 사용자 응답을 막지 않습니다.

review는 반드시 router를 거치며, model alias는 `auto:learning`을 사용합니다.

현재 review는 Hermes 방식처럼 제한된 tool-calling loop로 실행합니다. 허용되는 tool은 아래 네 가지뿐입니다.

```txt
memory
skills_list
skill_view
skill_manage
```

review model이 provider/tool 문제로 tool call을 만들지 못하는 경우를 위해 JSON action fallback도 유지합니다.

```txt
memory_append
user_append
skill_create
skill_patch
skill_edit
skill_write_file
```

review 정책은 Hermes의 기준을 따릅니다.

- memory는 "사용자가 누구인지"와 안정적인 선호/환경 사실을 저장합니다.
- skill은 "이 종류의 작업을 이 사용자에게 어떻게 처리할지"를 저장합니다.
- 사용자가 style, tone, format, verbosity, workflow를 교정하거나 "앞으로/항상/다음부터/whenever"처럼 반복 처리 방식을 지정하면 memory-only로 끝내지 않고 skill update/create 신호로 봅니다.
- skill update 우선순위는 현재 관련 skill patch, 기존 umbrella skill patch, support file 추가, 새 class-level skill 생성 순서입니다.
- 새 skill 이름은 class-level kebab-case여야 하며 날짜/오늘 작업/특정 버그 같은 session artifact 이름은 피합니다.

실패해도 사용자 응답이나 다음 turn을 깨뜨리지 않습니다.

review 기록은 `~/.pie/agent/learning/reviews/*.json`에 저장합니다. 기록에는 실행 시간, 사용한 model alias, review mode, raw output, action 목록, 적용/제안/skip/실패 결과가 들어갑니다.

review mode:

```txt
auto     action을 바로 적용하고 기록을 남김
suggest  action을 proposal로만 저장하고 사용자가 승인해야 적용
off      background review 비활성화
```

CLI:

```bash
pie learning status
pie learning history
pie learning show <review-id>
pie learning proposals
pie learning approve <review-id>
pie learning reject <review-id>
pie learning mode auto|suggest|off
```

memory append 전에는 기존 문단과 유사도를 비교해 중복 저장을 건너뜁니다. skill create 전에도 이름과 description이 비슷한 기존 skill이 있으면 새 skill 생성을 skip하고 review 기록에 이유를 남깁니다.

## Curator Consolidation (LLM-driven)

구현 파일:

- `packages/coding-agent/src/core/learning/skill-curator.ts`
- `packages/coding-agent/src/curator-cli.ts`

agent 세션 종료 시 `maybeConsolidate()`가 호출됩니다. 마지막 실행으로부터 `consolidateIntervalDays`(기본 7일)가 경과하고 스킬이 5개 이상 있을 때만 LLM consolidation pass를 실행합니다.

LLM은 스킬 목록을 보고 `PREFIX-*` 클러스터를 식별한 뒤, 좁은 스킬들을 하나의 umbrella 스킬로 병합하고 원본을 archive합니다. 결과는 YAML 블록으로 반환됩니다:

```yaml
consolidations:
  - from: [gateway-auth-discord, gateway-auth-telegram]
    into: gateway-auth
    reason: "both handle bot token auth for different services"
prunings:
  - name: temp-test-skill
    reason: "no usage, created during testing"
```

수동 실행:

```bash
pie curator consolidate [--dry-run]
pie curator status   # consolidation 상태 포함
```

## Router Policy

구현 파일:

- `packages/router/src/index.ts`

Learning Loop용 router alias를 추가했습니다.

- `auto:learning`: memory/skill review + curator consolidation용
- `auto:memory`: user modeling 보조 호출용

두 alias는 일반 coding 작업보다 저렴한 모델을 우선하도록 scorer에서 작은 모델/저비용 모델에 가중치를 줍니다. `auto:learning`과 `auto:memory` 모두 `AgentSession`의 router stream 경로를 통과하므로 usage/cost record에는 요청 alias, 실제 provider/model, token usage, cost가 남습니다.

## Curator

구현 파일:

- `packages/coding-agent/src/core/learning/skill-curator.ts`
- `packages/coding-agent/src/curator-cli.ts`

curator는 agent가 자동 생성한 스킬을 정리하는 기능입니다. Learning Loop가 스킬을 계속 만들면 비슷한 스킬, 오래 안 쓰는 스킬, 임시 스킬이 쌓일 수 있으므로 이를 관리합니다.

관리 대상은 `.usage.json`에 `createdBy: "agent"`로 기록된 스킬뿐입니다. 사용자나 프로젝트가 직접 만든 스킬은 자동 archive 대상이 아닙니다.

기본 정책:

```txt
staleAfterDays: 30
archiveAfterDays: 90
autoArchive: true
backupBeforeRun: true
pruneAfterDays: 180
```

지원 명령:

```bash
pie curator status
pie curator run
pie curator pin <skill>
pie curator unpin <skill>
pie curator archive <skill>
pie curator restore <skill>
pie curator backup
pie curator prune [--dry-run]
pie curator rollback [backupPath]
pie curator settings [--stale-days N] [--archive-days N] [--prune-days N]
```

`--json` 출력도 지원합니다.

```bash
pie curator status --json
pie curator run --json
```

상태 의미:

- `active`: 정상 사용 가능
- `stale`: 오래 사용하지 않아 점검 대상
- `pinned`: 사용자가 보호한 스킬
- `archived`: 삭제하지 않고 `.archive`로 이동된 스킬

archive는 실제 삭제가 아니라 `~/.pie/agent/skills/.archive`로 이동입니다. `run`은 실행 전에 `~/.pie/agent/skills/.backups`에 상태 백업을 남깁니다.

`--dry-run`을 붙이면 실제 archive/prune 없이 어떤 스킬이 대상인지 확인합니다. `rollback`은 `.backups`에 저장된 agent-created skill snapshot을 기준으로 active/archive 상태를 되돌립니다. 사용자 직접 생성 스킬은 rollback이나 prune의 자동 관리 대상이 아닙니다.

스킬 사용량은 다음 시점에 기록됩니다.

- `/skill:<name>`으로 스킬을 명시 사용하면 `useCount`, `lastUsedAt` 갱신
- `skill_view`로 보면 `viewCount`, `lastViewedAt` 갱신
- `patch`, `edit`, `write_file`, `remove_file` 실행 시 `patchCount` 갱신

## 설정 기본값

현재 기본값은 다음과 같습니다.

```json
{
  "learning": {
    "enabled": true,
    "review": {
      "mode": "auto"
    },
    "memory": {
      "enabled": true,
      "reviewIntervalTurns": 5
    },
    "skills": {
      "enabled": true,
      "autoSave": true,
      "reviewToolIterations": 8,
      "curatorEnabled": true,
      "curator": {
        "staleAfterDays": 30,
        "archiveAfterDays": 90,
        "autoArchive": true,
        "backupBeforeRun": true,
        "pruneAfterDays": 180,
        "consolidateIntervalDays": 7
      }
    }
  }
}
```

## `.pi`에서 `.pie`로 정리한 내용

Pie의 실제 설정/데이터 경로는 `.pie` 기준으로 정리했습니다.

대표 경로:

```txt
~/.pie/agent
.pie/
.pie/skills
```

`pkg.pi`나 `piConfig` 같은 package metadata 호환 필드는 유지했습니다. 이는 `.pi` 디렉터리 경로가 아니라 기존 package manifest 호환을 위한 이름이므로, 별도 마이그레이션 없이 바꾸면 기존 package/extension 로딩이 깨질 수 있습니다.

## 검증

Learning Loop와 curator 관련 검증:

```bash
npm run build --workspace @pie-lab/coding-agent
npm run test --workspace @pie-lab/coding-agent -- learning
node packages/coding-agent/dist/cli.js curator --help
```

추가로 `.pi` 경로 정리 후 실제 `.pi` path 검색에서 남은 항목이 없음을 확인했습니다.

전체 `@pie-lab/coding-agent` 테스트에는 아직 Learning Loop와 무관한 실패가 일부 남아 있습니다.

- `pi.dev` / `pielab.ai` 브랜딩 기대값 차이
- CLI help 종료 코드 관련 stdout cleanliness 테스트

이 실패들은 Learning Loop나 `.pie` 경로 변경과 직접 관련된 실패는 아닙니다.

## 현재 한계

현재 구현은 Hermes의 전체 skill ecosystem 복제가 아니라 Pie Learning Loop에 필요한 핵심 기능 중심입니다.

아직 포함하지 않은 것:

- 외부 skill registry / tap / HuggingFace skills hub 연동
- `skills search/install/inspect/update/uninstall/publish/browse` 전체 명령군
- 스킬 설치 전 guard/audit 전체 기능
- curator의 `pause`, `resume` 같은 실행 스케줄 제어
- TUI Skills Hub 화면
- 플랫폼별 skill enable/disable 운영 UI

다음 확장 후보:

- skills hub 설치/검사 기능 추가하기
- dashboard에서 memory/skill/curator 상태 편집을 더 고도화하기
