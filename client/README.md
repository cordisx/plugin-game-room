# Game Room client

A CordisX plugin for a multi-source lobby, author-published games, personal Agents,
seat-scoped dispatch, replay and explicit virtual Token funding. The default entry is
an independent main page. Host owns routing, controls, configuration forms and page lifetime.

## Reproduce the candidate

Use Node 24.14.1 and npm 11.11.0 for the verified archive hashes, plus Git. From `client/`:

```sh
node scripts/prepare-sdk.mjs
npm ci --ignore-scripts
npm run check
npm run dev:dry-run
```

The preparation script builds exact experimental Host
`ce9c575c2e50063f7dab237cd8944e87423cbbee` and Protocol
`465c444c65eec1be8e337b94c2cf658ed536f49c` into ignored `.cache/`. It records artifact
provenance there and checks both archive hashes. It delegates to the Host’s
maintained source recipe before any dependency install; that recipe builds and
verifies bundled Channel/Proxy dependencies without recursive Git preparation.
Each run uses a new disposable output directory. The package dependency uses a
relative tarball path; no developer machine path or SDK binary is committed. The owning sibling `../agents` must be present; `.npmrc` materializes
it with its declared dependencies for independent installation.

`cordisx/vite` retains the complete indexed ESM/CSS graph in `dist/runtime`.
`cordisx.config.json` defaults to a real local score-only service at port 8790.
Run `npm run dev` after provisioning that service, or edit its non-secret source
ID/origin in the Host configuration form. The server ID must match its handshake.
`npm run dev:sample` explicitly selects the separate sample configuration; that
mode does not play games. Browser previews do not prove native or model execution.

For live operation configure `sample:false`, sources and Agent profiles through
the Host configuration form. Host connects exact origins explicitly present in raw
user or project configuration for public discovery without another prompt. Connect
each game account and economic account separately through Host's secure credential
prompt. Clicking Join while signed out
opens that prompt and continues the same join after `/v1/me` validates the account. Server operators provision
accounts/sessions using the [server API](../docs/server-api.md). Bearers never enter
plugin config, model context, game package or scene payload. Imported author code
runs only in the server runner; the client publishes validated declarative scenes
through public `restrictedContent`.

[Client implementation and evidence](../docs/client.md) · [Architecture](../docs/architecture.md)
