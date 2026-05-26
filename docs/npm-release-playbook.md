# npm Release Playbook

이 문서는 pie-lab CLI를 npm에 배포할 때 따르는 실제 운영 절차입니다.

기준 배포 채널은 다음 두 가지입니다.

- npm: `pie` CLI와 runtime package 배포
- GitHub Pages: `install.sh` 배포

## 현재 배포 대상

사용자 기본 설치는 다음 패키지를 통해 이뤄집니다.

```txt
@pie-lab/coding-agent
```

`@pie-lab/coding-agent`가 의존하는 public runtime package는 다음입니다.

```txt
@pie-lab/ai
@pie-lab/tui
@pie-lab/router
@pie-lab/storage
@pie-lab/shared
@pie-lab/agent-core
```

따라서 npm에 배포해야 하는 package set은 총 7개입니다.

```txt
@pie-lab/ai
@pie-lab/tui
@pie-lab/router
@pie-lab/storage
@pie-lab/shared
@pie-lab/agent-core
@pie-lab/coding-agent
```

`@pie-lab/web-ui`는 배포 대상이 아닙니다. 현재 웹 채팅은 `apps/chat`의 Next.js 앱으로 관리합니다.

## 중요한 운영 원칙

- `npm unpublish`는 되도록 사용하지 않습니다. npm은 같은 package/version 조합의 재게시를 막을 수 있습니다.
- npm access token, OTP, recovery code는 문서와 로그에 남기지 않습니다.
- 채팅이나 터미널에 token을 노출했다면 배포 후 바로 revoke/rotate 합니다.
- 배포 전에는 반드시 `npm run prepublishOnly`를 통과시킵니다.
- 실제 publish 때는 이미 검증된 `dist`를 재사용하기 위해 workspace별 `npm publish --ignore-scripts`를 사용할 수 있습니다.
- `packages/ai`의 model generator는 외부 registry 값을 가져오기 때문에, 배포 직전 원치 않는 generated diff가 생겼는지 확인합니다.

## 버전 업데이트

현재 release line은 `0.1.x`입니다.

버전을 올릴 때는 runtime package와 내부 `@pie-lab/*` 의존성을 같은 버전 범위로 맞춥니다.

예: `0.1.2`

```txt
package version: 0.1.2
internal dependency: ^0.1.2
```

대상 파일 예시는 다음입니다.

```txt
package.json
apps/server/package.json
apps/dashboard/package.json
apps/chat/package.json
packages/agent/package.json
packages/ai/package.json
packages/chat/package.json
packages/coding-agent/package.json
packages/router/package.json
packages/shared/package.json
packages/storage/package.json
packages/tui/package.json
```

버전 수정 후 lockfile과 shrinkwrap를 갱신합니다.

```bash
npm install --package-lock-only --ignore-scripts
node scripts/generate-coding-agent-shrinkwrap.mjs
```

## 배포 전 검증

먼저 전체 build/check 흐름을 실행합니다.

```bash
npm run prepublishOnly
```

확인할 내용:

- `packages/web-ui`를 찾는 오류가 없어야 합니다.
- dashboard와 chat Next.js build가 통과해야 합니다.
- `packages/coding-agent/npm-shrinkwrap.json`이 최신이어야 합니다.

shrinkwrap check:

```bash
node scripts/generate-coding-agent-shrinkwrap.mjs --check
```

공백/형식 check:

```bash
git diff --check
```

generated model diff 확인:

```bash
git diff -- packages/ai/src/models.generated.ts packages/ai/src/image-models.generated.ts
```

의도하지 않은 model price/metadata 변경이 생겼다면 배포 전에 되돌리거나 별도 변경으로 분리합니다.

## npm 인증

일반 `npm login` 세션으로 publish하면 2FA 때문에 `EOTP` 또는 browser auth URL이 뜰 수 있습니다.

자동 배포나 CLI 배포에는 2FA bypass가 설정된 granular access token을 사용하는 편이 안정적입니다.

토큰을 사용할 때는 값을 출력하지 않는 임시 `.npmrc`를 씁니다.

```bash
tmp_npmrc="$(mktemp)"
trap 'rm -f "$tmp_npmrc"' EXIT
printf '%s\n' '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > "$tmp_npmrc"
export NPM_TOKEN='<npm-token>'
```

이후 명령에는 다음 환경변수를 붙입니다.

```bash
NPM_CONFIG_USERCONFIG="$tmp_npmrc" npm view @pie-lab/coding-agent version
```

## 배포 명령

이미 `npm run prepublishOnly`로 build/check를 통과했다면, publish 단계에서는 재빌드를 피하기 위해 `--ignore-scripts`를 사용합니다.

```bash
for pkg in \
  @pie-lab/ai \
  @pie-lab/tui \
  @pie-lab/router \
  @pie-lab/storage \
  @pie-lab/shared \
  @pie-lab/agent-core \
  @pie-lab/coding-agent
do
  echo "Publishing $pkg..."
  NPM_CONFIG_USERCONFIG="$tmp_npmrc" npm publish --workspace "$pkg" --access public --ignore-scripts
done
```

루트 script도 같은 package set만 배포하도록 유지합니다.

```bash
npm run publish
```

단, token/2FA 이슈가 있을 때는 위의 임시 `.npmrc` 방식으로 workspace별 배포를 실행합니다.

## 배포 후 검증

모든 패키지 version이 npm registry에서 보이는지 확인합니다.

```bash
for spec in \
  @pie-lab/ai@0.1.2 \
  @pie-lab/tui@0.1.2 \
  @pie-lab/router@0.1.2 \
  @pie-lab/storage@0.1.2 \
  @pie-lab/shared@0.1.2 \
  @pie-lab/agent-core@0.1.2 \
  @pie-lab/coding-agent@0.1.2
do
  printf '%s ' "$spec"
  npm view "$spec" version
done
```

`latest` tag 확인:

```bash
for pkg in \
  @pie-lab/ai \
  @pie-lab/tui \
  @pie-lab/router \
  @pie-lab/storage \
  @pie-lab/shared \
  @pie-lab/agent-core \
  @pie-lab/coding-agent
do
  printf '%s ' "$pkg"
  npm dist-tag ls "$pkg"
done
```

깨끗한 임시 프로젝트에서 설치 검증:

```bash
tmp_dir="$(mktemp -d)"
cd "$tmp_dir"
npm init -y >/dev/null
npm install --ignore-scripts @pie-lab/coding-agent@0.1.2
./node_modules/.bin/pie --version
npm ls @pie-lab/web-ui --depth=0 || true
```

기대 결과:

```txt
pie --version => 0.1.2
@pie-lab/web-ui => installed tree에 없어야 함
```

## GitHub Pages installer 검증

GitHub Pages는 `site/install.sh`를 배포합니다.

배포 후 script가 접근 가능한지 확인합니다.

```bash
curl -fsSL https://jikime.github.io/pie-lab/install.sh
```

실제 설치 검증:

```bash
npm uninstall -g @pie-lab/coding-agent
curl -fsSL https://jikime.github.io/pie-lab/install.sh | sh
pie --version
pie --help
```

## 이번 0.1.2 배포 기록

`0.1.2` 배포에서 확인한 사항:

- `@pie-lab/web-ui`는 runtime 배포 대상에서 제외했습니다.
- `packages/web-ui` 삭제에 맞춰 root `workspaces`, `build`, `dev`, `check`, `publish` 흐름에서 web-ui 참조를 제거했습니다.
- `npm run prepublishOnly`가 통과했습니다.
- 다음 7개 패키지를 `0.1.2`로 배포했습니다.

```txt
@pie-lab/ai@0.1.2
@pie-lab/tui@0.1.2
@pie-lab/router@0.1.2
@pie-lab/storage@0.1.2
@pie-lab/shared@0.1.2
@pie-lab/agent-core@0.1.2
@pie-lab/coding-agent@0.1.2
```

- `latest` tag도 모두 `0.1.2`로 확인했습니다.
- 임시 폴더에서 `npm install --ignore-scripts @pie-lab/coding-agent@0.1.2`가 성공했습니다.
- 설치된 CLI에서 `pie --version`이 `0.1.2`로 출력됐습니다.
- `@pie-lab/web-ui`가 설치 tree에 포함되지 않는 것을 확인했습니다.

## 과거 예외 기록

초기 npm 복구 과정에서 `@pie-lab/agent-core@0.1.0`이 unpublish 처리된 적이 있습니다.

npm은 같은 package/version 조합의 재게시를 허용하지 않을 수 있으므로, `@pie-lab/agent-core@0.1.0`은 다시 사용하지 않습니다. 이 문제 때문에 초기 usable release는 다음 조합이었습니다.

```txt
@pie-lab/coding-agent@0.1.0
@pie-lab/agent-core@0.1.1
```

`0.1.2`부터는 다시 모든 runtime package를 같은 version으로 맞췄습니다.
