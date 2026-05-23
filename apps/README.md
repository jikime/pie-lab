# pie-lab apps

`apps/` contains integration-facing applications added on top of the imported `pi` source tree.

- `dashboard`: 9router-derived dashboard experience.
- `server`: local OpenAI-compatible and ADK-native API server.
- `chat-bridge`: pie-chat-derived Discord/Telegram bridge.

These apps should call the shared packages instead of duplicating provider, routing, storage, or chat bridge logic.
