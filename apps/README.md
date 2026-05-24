# pie-lab apps

`apps/` contains integration-facing applications added on top of the imported `pi` source tree.

- `dashboard`: Next.js-based 9router and learning dashboard experience.
- `dashboard_old`: legacy Vite dashboard kept as a comparison/reference app.
- `server`: local OpenAI-compatible and ADK-native API server.
- `chat`: pie-chat-derived web chat and Discord/Telegram bridge experience.

These apps should call the shared packages instead of duplicating provider, routing, storage, or chat bridge logic.
