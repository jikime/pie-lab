# dashboard-next 이관 범위

이 문서는 기존 `apps/dashboard`에 들어간 9router 운영 기능을 `apps/dashboard-next`로 옮길 때의 기준입니다.

현재 방향은 기존 Vite dashboard를 바로 버리는 것이 아닙니다. `apps/dashboard`는 기능 검증용 기준판으로 유지하고, `apps/dashboard-next`는 Next.js 16, Tailwind CSS 4, shadcn/ui 기반의 제품화 dashboard로 단계적으로 완성합니다.

## 현재 판단

`apps/dashboard`는 단일 `main.ts` 중심이라 구조는 무겁지만, usage, provider connection, OAuth, quota detail, model availability, proxy pool, routing policy, budget, request detail, raw trace 같은 기능이 많이 들어가 있습니다.

`apps/dashboard-next`는 화면 구조, navigation, SEO, Pretendard, shadcn/ui 컴포넌트, 주요 페이지 골격과 주요 9router 운영 조작 기능을 갖춘 상태입니다. 기존 Vite dashboard는 비교 기준으로 유지하지만, 매일 보는 제품형 dashboard는 `apps/dashboard-next`를 기준으로 다듬습니다.

따라서 당분간 기준은 다음과 같습니다.

```txt
apps/dashboard
  -> 9router 운영 기능의 기준 구현

apps/dashboard-next
  -> 사용자가 매일 볼 제품형 dashboard
  -> 기존 기능을 기능별로 검증하며 단계적 이관
```

## 기능별 이관 상태

| 영역 | 기존 dashboard 상태 | dashboard-next 상태 | 남은 일 |
| --- | --- | --- | --- |
| Overview | usage, provider, quota, budget 일부 요약 | 기본 card와 provider health 요약 | request detail, budget, model availability 신호 요약 개선 |
| Usage | usage list, summary, RTK saved, request detail button | usage list, summary, request detail sheet, fallback timeline, raw trace, origin/endpoint별 집계 | filtering과 RTK saved 표시 강화 |
| Logs | request detail과 raw trace 중심 | logs table과 request detail sheet | filter, search 개선 |
| Routing | combo, alias, intent 생성/삭제, preview, import/export, model suggestion | combo/alias/intent form 생성/삭제, JSON editor, preview | combo reorder, model suggestion 고도화 |
| Providers | provider status, connection 생성/활성화/삭제, OAuth token 저장, redirect login | provider status 조회, manual connection 생성, 활성화/비활성화, 삭제, OAuth redirect login, provider별 setup guide | token import form 고도화 |
| Quota | quota list, quota detail, account selection 이유 | quota list, quota detail sheet, account selection 조회 | refresh action, 선택 근거 문구 강화 |
| Model Availability | cooldown/lock 상태와 clear action | cooldown/lock table, clear cooldown action | provider/model grouping과 안내 문구 강화 |
| Budget | limit 설정, budget status, window별 사용량 | form 기반 설정, provider override, window별 사용량 preview, warn/block 상태 표시 | 사용성 문구 개선 |
| Proxy | proxy pool 생성, 테스트, 수정, 삭제, connection binding | proxy pool 생성/수정/삭제/테스트, active/strict toggle, provider connection proxy assignment | connection 목록 필터 개선 |
| Media | media routes와 provider coverage 확인 | media routes 조회, endpoint별 test form | provider coverage 문구 개선 |
| Settings | quota, RTK, budget, fallback 설정 | settings JSON 저장과 RTK toggle | 안전한 form control, validation, import/export |
| Build | root build에 포함 | root build에 아직 미포함 | 교체 시점에 root build 포함 여부 결정 |

## 우선순위

1. `Usage`와 `Logs`를 먼저 완성합니다.
   사용자가 라우팅이 제대로 됐는지, 비용이 얼마인지, fallback이 어떻게 일어났는지 가장 먼저 확인해야 하기 때문입니다. 현재는 request detail sheet와 raw trace 1차 구현까지 들어갔고, 다음은 filtering과 RTK saved 표시 강화입니다.

2. `Providers`를 완성합니다.
   provider connection CRUD, OAuth redirect login, token import가 dashboard에서 가능해야 신규 사용자가 CLI 없이 시작할 수 있습니다. 현재는 manual connection 생성, 활성화/비활성화/삭제, OAuth redirect login 1차 구현까지 들어갔고, 다음은 provider별 안내와 token import form 고도화입니다.

3. `Quota`와 `Model Availability`를 완성합니다.
   왜 특정 account가 선택됐는지, 어떤 모델이 cooldown인지 보여야 9router 통합의 의미가 분명해집니다. 현재는 quota detail sheet와 model cooldown clear 1차 구현까지 들어갔고, 다음은 선택 근거 문구와 grouping 고도화입니다.

4. `Routing` 편집 기능을 JSON editor에서 form 기반 UI로 확장합니다.
   alias, intent, combo, reorder, import/export가 화면에서 안정적으로 동작해야 합니다. 현재는 combo, alias, intent의 생성/삭제와 preview 1차 구현까지 들어갔고, 다음은 combo reorder와 model suggestion 고도화입니다.

5. `Budget`, `Proxy`, `Media`를 운영 기능으로 다듬습니다.
   현재 form 기반 budget 설정, proxy 수정/삭제/binding, media endpoint test form까지 이관되었습니다. 남은 작업은 사용성 문구와 필터 개선입니다.

## 완료 기준

`apps/dashboard-next`가 기존 dashboard를 대체하려면 아래 조건을 만족해야 합니다.

- 최근 usage record와 summary를 볼 수 있습니다.
- request 하나를 열어 fallback attempt timeline과 raw event trace를 볼 수 있습니다.
- provider connection을 생성, 수정, 활성화, 비활성화, 삭제할 수 있습니다.
- OAuth redirect login과 token import가 dashboard 안에서 가능합니다.
- quota detail과 account selection 이유를 확인할 수 있습니다.
- model cooldown 상태를 보고 필요한 경우 clear할 수 있습니다.
- routing policy의 combo, alias, intent를 form으로 편집하고 preview할 수 있습니다.
- budget limit을 form으로 설정하고 현재 사용량 window를 볼 수 있습니다.
- proxy pool을 생성, 수정, 삭제, 테스트하고 provider connection에 연결할 수 있습니다.
- media endpoint route와 provider coverage를 확인하고 endpoint별 test form을 실행할 수 있습니다.
- root `npm run build` 기준에 포함해도 안정적으로 빌드됩니다.

## 진행 원칙

한 번에 모든 화면을 새로 만들지 않습니다. 기존 dashboard에서 이미 동작하는 API와 동작 방식을 확인한 뒤, `dashboard-next`에 작은 단위로 옮깁니다.

화면을 옮길 때는 다음 순서로 진행합니다.

```txt
1. 기존 dashboard의 API 호출과 사용자 동작 확인
2. dashboard-next lib/api-client.ts에 필요한 API 추가
3. shadcn/ui 기반 page component 구현
4. loading/error/empty 상태 확인
5. server와 함께 실제 브라우저에서 동작 확인
6. 기존 dashboard와 결과 비교
```

이 방식으로 진행하면 `dashboard-next`가 단순히 예쁜 shell이 아니라, 실제 9router 운영에 필요한 화면으로 안전하게 바뀝니다.
