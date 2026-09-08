# Game Room client

A CordisX plugin for a multi-source game lobby, personal Agents, dispatch,
source-bound invitations and explicit rules/economy consent. Host owns headers,
route tabs, controls and page lifetime. Product views occupy `manager.content`.

The independent `client/` package was generated with the maintained creator at
Host `b75fa2c6f9563924feca271242e2709c136033a3`. Production uses `cordisx/vite`
and retains the complete indexed ESM/CSS graph in `dist/runtime`.

- `npm run check`: formatting, source/CSS lint, types, behavior tests, build.
- `npm run dev:dry-run`: validate the configured source without opening an App.
- `cordisx.config.json`: explicitly labelled sample-data Playground composition.

Current development SDK is a local baseline build. This is a development
checkpoint, not a portable release, native verification or user acceptance.
The live HTTP adapter consumes the owning `docs/server-api.md`; secure login,
isolated uploaded UI and Agent execution require the corresponding Host services.
No uploaded game code is imported into the trusted renderer.

[Client guide](../docs/client.md) · [Architecture](../docs/architecture.md)
