# @pie-lab/dashboard-next

`pie-lab`의 차세대 대시보드입니다.

기존 `apps/dashboard`는 Vite 기반 단일 페이지 대시보드이고, 이 앱은 9router의 메뉴형 대시보드 구조를 참고해 Next.js App Router 기반으로 다시 구성한 버전입니다.

## 기술 스택

- Next.js 16
- Tailwind CSS 4
- shadcn/ui
- React 19
- App Router
- Pretendard

## 실행

먼저 API 서버가 필요합니다.

```bash
npm --workspace @pie-lab/server run dev
```

다른 터미널에서 대시보드를 실행합니다.

```bash
npm --workspace @pie-lab/dashboard-next run dev
```

기본 주소:

```txt
http://127.0.0.1:4876
```

브라우저에서 호출하는 API 기본값은 다음입니다.

```txt
http://127.0.0.1:4873
```

다른 API 서버를 사용하려면 다음 환경변수를 지정합니다.

```bash
NEXT_PUBLIC_PIE_API_BASE_URL=http://127.0.0.1:4873 npm --workspace @pie-lab/dashboard-next run dev
```

SEO의 기준 도메인은 기본적으로 `https://pielab.ai`입니다.
배포 환경에서 다른 canonical URL을 써야 한다면 다음 환경변수를 지정합니다.

```bash
NEXT_PUBLIC_SITE_URL=https://pielab.ai npm --workspace @pie-lab/dashboard-next run build
```

## 현재 메뉴

- Overview
- Routing
- Providers
- Usage
- Quota
- Media
- Proxy
- Logs
- Settings

## 현재 역할

이 앱은 아직 기존 `apps/dashboard`를 대체하지 않습니다.

먼저 Next.js 기반 메뉴 구조와 shadcn/ui 컴포넌트 구조를 검증하고, 이후 기존 Vite 대시보드의 세부 편집 기능을 단계적으로 옮깁니다.
