# Client implementation and verification

Audience: plugin maintainers. [Server API](server-api.md) owns wire semantics;
[architecture](architecture.md) owns scope. This records implementation and evidence,
not user acceptance or a released Host capability.

## Build and ownership

`client/` is an independent npm package generated from the maintained Host creator.
Follow [reproduction](../client/README.md): `prepare-sdk.mjs` fetches exact Host
`1d2636adbe239550fd70e3e82d4b43681a800833` and Protocol
`465c444c65eec1be8e337b94c2cf658ed536f49c`, builds/packs into ignored `.cache`, and
checks the expected archive hashes against `sdk-evidence.json`. Final candidate
Host archive SHA256:
`fbb47a38f3dc31b1db8ffd78b8b182dae1f01ed9de5c07c27f290af95e92a274`.
Protocol archive SHA256:
`9576e28592b44c589aa847f3e57c02db1731a664c5cfa5a0f1fd5c4b5a3e21c8`.
The wrapper invokes the Host’s `scripts/prepare-sdk.mjs` with a new absolute output
directory, before running any npm installation. The maintained recipe owns complete
Channel/Proxy compilation, dependency verification and executable permissions.
Reference build toolchain: Node 24.14.1 / npm 11.11.0; Linux fresh verification runs
in integration CI rather than repeating concurrent local cold builds.
The relative package dependency avoids machine paths. Sibling Agents are materialized
with `install-links=true`; its own exact Protocol dependency is preserved.

`cordisx/vite` emits indexed entry, lazy app chunks and CSS. Initial registration
has no imported page stylesheet. Runtime React comes only from `cordisx/react`.

Host owns Header, three top-level tabs (Lobby, My Agents, Dispatch), controls,
configuration, outer padding and Manager scrolling. Client owns room results and
right Agent panel. History, balances, replay and funding are child routes. Sources
are simultaneous inputs, with no global current-server switch. Sidebar uses the
distinct label “游戏大厅”.

## Live boundaries

- `data/aggregate.ts` publishes each source independently, bounds timeouts and fences
  obsolete/disposed results. Offline and incompatible sources remain visible.
- `data/live.ts` consumes authoritative HTTP v1. Catalog selection binds source and
  package hash, including publisher and version; same-id packages do not collide.
  Invitations bind exact origin/server/room. Existing owned seats resume by GET.
- `data/host-http.ts` uses public authorize/request/exchange. Game and economy use
  separate opaque connections even at one origin. Derived Agent credentials stay
  in Host; exchanges return redacted metadata and handles. Requests forward abort
  and deadlines; grant revocation invalidates the local derived handle.
- `data/package-upload.ts` parses/hash-checks JSON without evaluating author source.
  Server QuickJS produces scene-v1. `GameSurface` only publishes through public
  restrictedContent. Trusted closures bind server/room/match/seat/version; author
  payload supplies only JSON action data. No HTML, iframe or private bridge path.
- Actions use stable request identities across lost acknowledgements. The scene
  callback publishes the newer authoritative scene before accepting. Definite
  rejection is distinguished from uncertainty; the UI can retry the same request.
  Replay uses owned-seat event views and disables action nodes.
- Token confirmation is tied to package/version/rules/review/stake/policy, and resets
  on changes. Unreviewed packages remain allowed. Wallet identity, agreement hash,
  match, game, conserved policy, all owned seat IDs and total exposure are checked
  before reserve. Only one-use link proof reaches the game server. Reserve retries
  preserve the idempotency key. Economic instances are never summed or exchanged.
- `data/agents.ts` connects the public dispatch adapter and controlled AgentLoop
  creation. Each seat has a bounded grant, action/model-call/time budgets and a
  fresh game task. Dispatch works without Pet/usage/Token services in score mode.
  Model token counts are not treated as currency or fabricated billing evidence.
  Cleanup withdraws active runs, closes the service and releases component mounts.

## CSS

Foundation and lobby styles own only `gr-*` DOM. Semantic tokens derive from public
`--cx-*` tokens. Main layout collapses below 1120px and room cards below 720px.
Host controls have no selector overrides. dprint/Malva, Stylelint and shared ESLint
max-lines policy run in the independent client gate.

## Verification record

With final Host `1d2636a`, `npm --prefix client run check` passes formatting,
source/CSS lint, typecheck, 11 behavior tests (one real-server test explicitly
skipped), build and verification of all four indexed runtime files.
`dev:dry-run` also passes. Existing-client installation of the complete SDK took
four seconds, with no recursive Git build. The wrapper passed syntax checking;
its full clean-source execution and actual archive hashes are a Linux CI gate.

An earlier eleven-test run passed, including
an actual two-server HTTP test against server scene checkpoint `88155a8`: duplicate
manifest IDs from different publishers, exact package selection, two-player ready /
start / action / finish, lost-ACK retry, private-state exclusion, replay, next-match
reset and independent source outage. Other tests cover invitations, lifecycle
fences, inert package parsing, role-scoped HTTP handles, derived grant revocation
and multi-seat economic consent with same-key reserve recovery. The separate
lightweight security run now passes five tests, including actual HTTP streaming
at exactly 2,000,000 bytes, rejection at 2,000,001 bytes and propagated mid-stream
abort. This check does not start QuickJS or a native App.

To include real HTTP in the client gate, build the root server and run:

```sh
GAME_ROOM_SERVER_MODULE="$PWD/dist/server/http.js" npm --prefix client test
```

Without this environment variable, the HTTP integration test is explicitly skipped.
The final-candidate local check intentionally did not set that environment
variable or repeat the sandbox/native lane. The preceding real-HTTP full check
failed with `rule_failure` while publishing a
healthy fixture under machine-wide load 40–73 on eight cores; server ownership
reported the same healthy-guest timeouts. No runtime limits were relaxed. The
updated server `66adc014ff790d2e204236a6c049c3720d249f82` has been merged as a read-only
dependency baseline; final client regression against its immutable build is pending.

Fresh-entry browser review, dark/responsive review,
native installed-generation lifecycle, real-model dispatch and real-wallet UI
funding are separately tracked; no sample screenshot proves those outcomes.
The old preview entry was retracted after a fresh-window navigation failure; do not
use “open Manager manually” as acceptance. Unified Host includes its fix and is
awaiting fresh-entry verification. The owner stopped its recursive dependency
install trees, then restarted the sole lightweight Playground at
`http://127.0.0.1:43129/` using existing dependencies, Host source `5101d6e` and the
provider experimental dist. Homepage and source-runtime requests return HTTP 200.
This is HTTP readiness only: Mac lock blocked CUA, so fresh clicks/screenshots wait
for unlock. No existing user App was restarted.

The superseded H510 archive mismatch was traced to executable metadata alone.
H1d2636a now fixes entry modes in its build and bundles complete Channel, Proxy
and Protocol dependencies. Client lock and preparation consume that single
maintained recipe; no consumer-side archive-mode override or incomplete bootstrap
package is used. Local final-candidate checks and fresh Linux CI results are
reported separately from browser/native acceptance.
