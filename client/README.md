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

The preparation script verifies the committed owner-built SDK archives against
`../sdk/release/sdk-evidence.json`: Host
`6d241082ac18c59de2983bdbb32c7c79e4a98168` and Protocol
`55621cd211d48783eb0f729f2925b54bd621a810`. These archives identify the supported
source baseline; the shared `0.1.0-beta.3` version alone does not establish
compatibility with other Host builds. The package dependencies use relative
tarball paths. The owning sibling `../agents` must be present; `.npmrc` materializes
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

## Plugin brand icon

`assets/icon.png` is the owned 256×256 brand asset. The public plugin-module
`icon` export embeds its PNG bytes as `CordisXPluginBrandIcon`; Host renders that
metadata in the plugin list. Runtime manifest permissions and semantic menu
icons remain separate. Regenerate the metadata with
`node scripts/generate-brand-icon.mjs` when replacing the PNG. Tests check the
bytes, and the artifact check verifies that the production entry retains them.

This private client is distributed from repository source, with development
entry `src/client.tsx` and built entry `dist/runtime/module.js`. Its package
allowlist includes the original PNG and the built runtime. There is no client
npm publication or release-tag step for a brand-asset update.
