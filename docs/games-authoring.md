# Build and publish a game

See [example game rules](games.md) and the authoritative [server API](server-api.md).
A GamePackage contains a manifest, classic JavaScript rules source, and
`ui:{format:"scene-v1",render:string}`. Both rules and UI generation run in fresh
server-side QuickJS guests. The client receives a declarative scene, never the
UI generator script. HTML, CSS, URLs and browser scripts are not a delivery path.

## Build the examples

Use Node 24.14 or newer. The games workspace owns its package and lockfile.

```sh
cd games
npm ci
npm run check
```

The check runs formatting, source lint, real QuickJS behavior tests, reproducible
builds and package smoke validation. Individual commands are available:

```sh
npm run build
npm run build -- gomoku
npm run validate -- dist/gomoku-1.0.0.json dist/texas-holdem-1.0.0.json
npm test
```

`build [directory]` prints artifact paths and canonical SHA-256 identities. The
hash covers recursively key-sorted JSON for the entire package. No timestamps or
machine paths are embedded. The repository MIT license is retained as a comment
in the distributed rules and render source. Generated `dist/` is ignored by Git.

`validate` checks package structure, then runs setup, every seat's observation,
UI generation and timeout in real fresh QuickJS runtimes at both player-count
boundaries. The offline scene check follows the public node/size constraints;
the actual server and Host independently validate them. A smoke pass cannot
prove arbitrary author code implements its intended privacy or game rules.

For integration against the actual compiled server:

```sh
node tools/server-check.mjs /absolute/path/to/plugin-game-room/dist/server/runner.js
node tools/http-check.mjs /absolute/path/to/plugin-game-room/dist/server/http.js
```

The first command exercises complete games through the real server runner and
transition validator. The second starts an isolated local SQLite-backed server,
uploads both packages, checks scenes, runs two-user matches, rejects an invalid
action, verifies idempotency, re-authenticates after restart, checks private
replays, starts a fresh match and expires a turn. Neither executes guest rules
or UI generators in Node.

## Author rules and scene generation

Create a directory under `games/` with `manifest.json`, `rules.js` and `render.js`.
The generic builder accepts its directory name. Hold'em additionally prepends its
cohesive evaluator source. Authoritative game code stays in that game's directory.

Rules assign `globalThis.game = {setup,act,timeout,observe}`. Every call receives
fresh globals, so serialize evolving state in `Transition.state`. Return a seat
index in `turn` until finished, then `turn:null` and a validated result. Use only
synchronous JSON values and the platform's `ctx.random`. Do not import libraries,
use files/network, native `Math.random`/`Date`, or disclose hidden state in
observations. Test all seats after folds, invalid actions, all-ins and termination.

The UI generator assigns `globalThis.render = (observation,context) => scene`.
Its only inputs are the requesting seat's observation and
`{seatIndex,seatCount,mode,canAct}`. It receives no private rules state, seed,
random generator, credentials, DOM, network, file system or Host APIs. Waiting
or failed observations may be `null`; return a simple waiting scene with no
old cards or actions. Derive all display state from these inputs.

Return `{version:1,root:node}` using the public
[`@cordisx/protocol/restricted-content/v1`](https://github.com/cordisx/cordisx-protocol/blob/465c444c65eec1be8e337b94c2cf658ed536f49c/types/restricted-content.v1.d.ts)
scene contract. The current experimental Protocol reference is
`465c444c65eec1be8e337b94c2cf658ed536f49c`; the source reference, not this guide, owns exact node fields and limits.
Available primitives are text, stack, grid, button and number-action. The Host
owns rendering, styling, layout and native controls. No game-specific Host node
or game allowlist is required.

A button contains a JSON action; `ariaLabel` supplies accessible coordinates for
symbolic board cells. A number-action combines a bounded safe integer with one
validated action key. Hold'em uses it to submit arbitrary legal raise totals:

```js
{
  type: 'number-action', label: '加注至',
  min: 40, max: 1000, step: 1, value: 40,
  action: {type: 'raise'}, valueKey: 'to'
}
```

The Host validates the integer and action, binds it to the displayed sequence,
and disables submitted controls until a newer scene arrives. The trusted client
adds server identity, room, seat, expectedVersion and idempotencyKey. Author code
never supplies those authorities. Server `act` still validates every action;
scene controls are not settlement or rule authority.

## Publish and create a room

Use the authenticated upload UI or send the generated JSON to `POST /v1/packages`
with an account bearer in the HTTP Authorization header. Keep the bearer in the
trusted client. Compare the returned immutable package hash with the build output.

A publisher/id/version cannot be replaced with different content. Increment
`manifest.version` before publishing changed rules or render source. Existing
rooms stay pinned to their original hash. Build and validate before publishing.
Legacy packages with `ui.html` are rejected; there is no HTML execution fallback.

For Gomoku choose two seats, empty configuration and `equal-winners-v1`. For
Hold'em choose 2–8 seats and `conserved-payouts-v1`; a local-chip config is
`{"initialStack":1000,"smallBlind":10,"bigBlind":20}`. All seats join and ready
before the creator starts. Token mode follows the server's exact terms and
consent schema, including package hash, policy and each seat's stake. Tokens are
virtual entertainment currency, with no real-money cashout.

A complete release additionally needs the actual trusted Host scene renderer and
its native action path, plus any real economic service used by token mode. Local
QuickJS tests and HTTP checks do not imply deployment or user acceptance. Earlier
HTML browser-fixture screenshots are historical design work and do not verify
the scene renderer.
