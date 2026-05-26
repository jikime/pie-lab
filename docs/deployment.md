# Deployment

This project uses two public distribution channels:

- GitHub Pages hosts the small installer script.
- npm hosts the actual `pie` CLI packages.

The dashboard, server, and chat apps are development and advanced local services. They are not part of the default global CLI install.

## Installer URL

The canonical installer URL is:

```bash
https://jikime.github.io/pie-lab/install.sh
```

Recommended install command:

```bash
curl -fsSL https://jikime.github.io/pie-lab/install.sh | sh
```

For inspection-first installs:

```bash
curl -fsSLO https://jikime.github.io/pie-lab/install.sh
sh install.sh
```

The installer checks for Node.js `>=22.19.0`, checks for npm, then runs:

```bash
npm install -g --ignore-scripts @pie-lab/coding-agent
```

## GitHub Pages

Static Pages source lives in:

```txt
site/
```

The deployment workflow is:

```txt
.github/workflows/pages.yml
```

Repository settings must use GitHub Actions as the Pages source:

```txt
Settings -> Pages -> Build and deployment -> Source -> GitHub Actions
```

The workflow deploys whenever `site/**` or the Pages workflow changes on `main`. It can also be run manually from GitHub Actions.

## npm Packages

The default CLI install depends on these public npm packages:

```txt
@pie-lab/coding-agent
@pie-lab/ai
@pie-lab/agent-core
@pie-lab/tui
@pie-lab/router
@pie-lab/storage
@pie-lab/shared
```

`@pie-lab/web-ui` is not part of the runtime release set. Pie Chat is maintained as the Next.js app in `apps/chat`.

The first public npm release line is `0.1.0`. Current packages are published at `0.1.2`. Keep published runtime package dependencies on the same minor release line so the CLI install resolves one coherent pie-lab build.

Release note: `@pie-lab/agent-core@0.1.0` was unpublished during the first npm recovery flow, and npm does not allow republishing the same package/version pair. The initial usable CLI release therefore uses `@pie-lab/agent-core@0.1.1` while the CLI package remains `@pie-lab/coding-agent@0.1.0`.

Dry-run the npm publish flow first:

```bash
npm run publish:dry
```

Publish after the dry-run succeeds and npm credentials are configured:

```bash
npm run publish
```

## Release Checklist

Detailed npm publish commands and recovery notes are maintained in [npm Release Playbook](./npm-release-playbook.md).

1. Commit all implementation and documentation changes.
2. Make sure GitHub Pages is enabled with GitHub Actions as the source.
3. Run the relevant package tests and builds.
4. Run `npm run publish:dry`.
5. Publish npm packages.
6. Push `main` so GitHub Pages deploys `site/install.sh`.
7. Verify the installer:

```bash
curl -fsSL https://jikime.github.io/pie-lab/install.sh
```

8. Test from a clean environment:

```bash
npm uninstall -g @pie-lab/coding-agent
curl -fsSL https://jikime.github.io/pie-lab/install.sh | sh
pie --version
pie --help
```
