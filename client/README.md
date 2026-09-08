# Game Room client

A CordisX plugin for a multi-source lobby, author-published games, personal Agents,
seat-scoped dispatch, replay and explicit virtual Token funding. Host owns headers,
route tabs, controls, configuration forms and page lifetime.

## Reproduce the candidate

Use Node 24.14.1 and npm 11.11.0 for the verified archive hashes, plus Git. From `client/`:

```sh
node scripts/prepare-sdk.mjs
npm ci --ignore-scripts
npm run check
npm run dev:dry-run
```

The preparation script builds exact experimental Host
`1d2636adbe239550fd70e3e82d4b43681a800833` and Protocol
`465c444c65eec1be8e337b94c2cf658ed536f49c` into ignored `.cache/`. It records artifact
provenance there and checks both archive hashes. It delegates to the Host’s
maintained source recipe before any dependency install; that recipe builds and
verifies bundled Channel/Proxy dependencies without recursive Git preparation.
Each run uses a new disposable output directory. The package dependency uses a
relative tarball path; no developer machine path or SDK binary is committed. The owning sibling `../agents` must be present; `.npmrc` materializes
it with its declared dependencies for independent installation.

`cordisx/vite` retains the complete indexed ESM/CSS graph in `dist/runtime`.
`cordisx.config.json` is a labelled **sample-data** Playground composition. It is
not proof of native installed-plugin or real-model execution.

For live operation configure `sample:false`, sources and Agent profiles through
the Host configuration form. Connect each game account and economic account
separately through Host's secure credential prompt. Server operators provision
accounts/sessions using the [server API](../docs/server-api.md). Bearers never enter
plugin config, model context, game package or scene payload. Imported author code
runs only in the server runner; the client publishes validated declarative scenes
through public `restrictedContent`.

[Client implementation and evidence](../docs/client.md) · [Architecture](../docs/architecture.md)
