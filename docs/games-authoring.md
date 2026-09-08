# Build and publish a game

See [example game rules](games.md) and the authoritative [server API](server-api.md).
A GamePackage is one JSON object with a manifest, classic JavaScript rules source,
and self-contained UI HTML. Its identity is SHA-256 of canonical recursively
key-sorted JSON, matching the platform's content-addressed upload contract.

## Build the examples

Use Node 24.14 or newer. The games workspace owns its package and lockfile; do not
install dependencies into the plugin root on its behalf.

```sh
cd games
npm ci
npm run build
npm run validate -- dist/gomoku-1.0.0.json dist/texas-holdem-1.0.0.json
npm test
npm run format:check
npm run lint
```

`build [gomoku|holdem]` prints artifact paths and content hashes. No timestamps or
machine paths are included in the artifact, so rebuilding unchanged sources gives
the same identity. `validate <file...>` checks package shape and self-contained UI,
then executes setup, each seat's observation and timeout in real fresh QuickJS
runtimes at both supported player-count boundaries. This smoke check is not a
proof that an arbitrary author's hidden-information or settlement logic is safe.

For integration against the actual server, have its owner build the server first:

```sh
node tools/server-check.mjs /absolute/path/to/plugin-game-room/dist/server/runner.js
node tools/http-check.mjs /absolute/path/to/plugin-game-room/dist/server/http.js
```

This imports the real server runner and SDK transition validator, exercises both
complete games, rejects an illegal action, checks per-seat poker visibility, and
checks final chip conservation. The HTTP check starts an isolated local SQLite-backed
server and uploads both packages, runs two-user matches, re-authenticates after a
server restart, inspects private replay views, starts a fresh match, and expires a
turn. Neither check executes guest rules in Node.

## Author another package

Create a directory inside `games/` with `manifest.json`, `rules.js`, `body.html`
and `ui.js`. The generic build command accepts its directory name; Hold'em also
prepends its cohesive evaluator source. Shared CSS is inserted before the body,
then the adapter before the game's UI. Generated JSON artifacts are ignored by
Git. Game-specific source remains in that game's directory.

Rules assign `globalThis.game = {setup,act,timeout,observe}`. Every call receives
fresh globals, so serialize all evolving state in `Transition.state`. Return a
seat index in `turn` until finished, then `turn:null` and a validated result.
Use only synchronous JSON-compatible values and the supplied `ctx.random`.
Do not import libraries, access files/network, use native `Math.random`/`Date`,
or place credentials or hidden state in observations. Tests must call every seat's
observation, including after folds, invalid actions, all-ins and termination.

A UI receives only seat observations and submits JSON actions through the Host's
restricted-content bridge. It has no server bearer token, wallet interface,
shared-origin privilege or authoritative rules execution. The source adapter is
[shared/adapter.js](../games/shared/adapter.js). Host and client owners provide the
transport; do not replace it with direct fetch, navigation or parent globals.

Own only the game body. The example dark CSS is scoped to this isolated document;
it does not target Host chrome. No fonts, scripts, styles or images load remotely.
The board and poker controls include disabled/pending states, accessible labels,
keyboard focus, and a narrow-screen layout. No animation is used.

## Publish and create a room

Use the authenticated package-upload UI or send the generated JSON to
`POST /v1/packages` with an account bearer token in the HTTP Authorization header.
Keep that bearer in the trusted client, never in the package or iframe. The server
returns the immutable hash, publisher identity and review status. Compare the
returned hash with the build output before creating a room.

The same publisher/id/version cannot be replaced with different bytes. Increment
`manifest.version` before publishing changed rules, styles or scripts. Existing
rooms remain pinned to their original hash. Uploading a package is publication;
build and validate locally before that step.

For Gomoku choose two seats, empty configuration and `equal-winners-v1`. For
Hold'em choose 2–8 seats and `conserved-payouts-v1`; a local-chip example config is
`{"initialStack":1000,"smallBlind":10,"bigBlind":20}`. All players join and ready
before the creator starts. For token mode, follow the server's exact terms and
consent schema, including immutable package hash, policy and each seat's stake.
Token coins are virtual entertainment currency, with no real-money cashout.

A complete release additionally needs actual server upload/join/start/action/
resume/replay testing and the Host's real isolated iframe path. A local rules
smoke or a browser fixture is not evidence of deployed or user-accepted behavior.
