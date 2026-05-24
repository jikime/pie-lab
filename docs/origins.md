# Source Origins

`pie-lab` is a separate git repository whose initial codebase is the `pi` source tree.

## Forks

- `pi`: https://github.com/earendil-works/pi
- `9router`: https://github.com/decolua/9router
- `pie-chat`: https://github.com/earendil-works/pi-chat
- `hermes-agent`: https://github.com/NousResearch/hermes-agent

## Imported Baseline

- `pi` baseline commit: `b94482762321ed0b9f8f245be57c84d786a7105d`
- `9router` fork HEAD when structure was created: `e1b821dd531b476d92b06ed11020dc465322b2f6`
- `pie-chat` fork HEAD when structure was created: `341426bd4137e5c88c06dbb98d8ca07f2fc12a2c`
- `hermes-agent` reference commit for Learning Loop design: `72ff3e909c73b625ee244ab5ea3d0608ee85dcf3`

## Integration Rule

The existing `pi` source and workflow should be preserved first. `9router` and `pie-chat` are integrated into this repository as router/operations and chat bridge layers. The `9router`-inspired dashboard and `pi-chat`-inspired chat UI are rebuilt as Next.js apps under `apps/dashboard` and `apps/chat`. `hermes-agent` is used as the reference design for persistent memory, automatic skill creation, background learning review, and skill curation.
