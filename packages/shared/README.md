# @pie-lab/shared

Shared constants and cross-package runtime utilities used by pie-lab apps and packages.

현재 포함 범위:

- pie-lab source repository metadata
- provider quota fetcher
- quota selection snapshot 생성/저장
- quota-aware provider connection preparer
- quota API request handler shared implementation

이 패키지는 `apps/server`와 `packages/coding-agent`가 같은 quota refresh/account scoring 흐름을 쓰기 위한 공통 위치입니다.

역할 기준:

- routing 판단 자체는 `@pie-lab/router`에 둡니다.
- provider connection 저장소는 `@pie-lab/storage`에 둡니다.
- quota를 가져와 selection snapshot으로 준비하는 cross-cutting glue는 `@pie-lab/shared`에 둡니다.
