# @pie-lab/dashboard

`pie-lab`의 기본 대시보드입니다.

이 앱은 9router의 메뉴형 대시보드 구조를 참고해 Next.js App Router 기반으로 구성한 버전입니다. 이전 Vite 기반 대시보드는 `apps/dashboard_old`에 보관합니다.

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
npm --workspace @pie-lab/dashboard run dev
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
NEXT_PUBLIC_PIE_API_BASE_URL=http://127.0.0.1:4873 npm --workspace @pie-lab/dashboard run dev
```

SEO의 기준 도메인은 기본적으로 `https://pielab.ai`입니다.
배포 환경에서 다른 canonical URL을 써야 한다면 다음 환경변수를 지정합니다.

```bash
NEXT_PUBLIC_SITE_URL=https://pielab.ai npm --workspace @pie-lab/dashboard run build
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
- Learning
- Settings

## 현재 역할

이 앱은 현재 기본 운영 대시보드입니다. 기존 Vite 대시보드는 비교와 회귀 확인이 필요할 때 `apps/dashboard_old`에서 별도로 실행합니다.
