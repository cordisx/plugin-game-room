# Client implementation and verification

Audience: plugin maintainers. [Server API](server-api.md) owns wire semantics;
[architecture](architecture.md) owns scope. This records implementation and evidence,
not user acceptance or a released Host capability.

## Build and ownership

`client/` is an independent npm package generated from the maintained Host creator.
Follow [reproduction](../client/README.md): `prepare-sdk.mjs` fetches exact Host
`ce9c575c2e50063f7dab237cd8944e87423cbbee` and Protocol
`465c444c65eec1be8e337b94c2cf658ed536f49c`, builds/packs into ignored `.cache`, and
checks the expected archive hashes against `sdk-evidence.json`. Final candidate
Host archive SHA256:
`7122ab3dc1bb9dd99905a511bb3c596c9b1880a6c88e681ca1d701c1c9623933`.
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

The sidebar opens `/main/game-room/lobby` in `main` with the public `body-only`
page contract, following the chatroom precedent. Plugin-owned header navigation
has three main destinations: Lobby, My Agents and Dispatch. Personal and settings
are separate utility actions. Only the source/Agent configuration form remains in
Manager. No private routing or Host selectors are used.

## Live boundaries

- `data/aggregate.ts` publishes each source independently, bounds timeouts and fences
  obsolete/disposed results. Exact origins in raw user or project configuration receive
  a Host-owned credential-free connection without another prompt. Other origins still
  require cancellable Host authorization outside the network timeout. Offline or
  incompatible sources remain visible with a direct refresh action.
- `data/live.ts` consumes authoritative HTTP v1. Catalog selection binds source and
  package hash, including publisher and version; same-id packages do not collide.
  Invitations bind exact origin/server/room. Join connects a signed-out account
  through Host capture and resumes the original operation after `/v1/me`. Resume
  buttons require authenticated `/v1/me/rooms` evidence; full or completed rooms
  without that evidence cannot claim an owned seat.
- `data/host-http.ts` uses public authorize/request/exchange. Game and economy use
  separate opaque connections even at one origin. Derived Agent credentials stay
  in Host; exchanges return redacted metadata and handles. Requests forward abort
  and deadlines; grant revocation invalidates the local derived handle. Public discovery
  uses a `none` connection, while account, Agent and economy operations retain separate
  bearer-scoped Host connections.
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

## CSS and icons

`foundation.css` owns shared plugin primitives and public `--cx-*` tokens;
`page-shell.css` owns the body-only viewport, header and one scroll body for detail,
Agent, dispatch and settings pages; `lobby.css` owns fixed filters and separate room
and Agent result scrollers. The lobby uses an 800px **container** breakpoint so
Host sidebar width is accounted for. The narrow layout retains the dedicated My
Agents route. Cards wrap without splitting button labels.

`components/icons.tsx` uses fixed, bundled Reicon 1.2.1 SVG assets, the same maintained
library already used by Host. Server-provided markup and emoji are not used for
lobby/Agent illustrations. Plugin CSS targets only owned `gr-*` presentation.
dprint/Malva, Stylelint and shared ESLint enforce formatting and source size.

## Verification record — 2026-09-09

The preceding unified candidate passed the fresh Linux SDK build inside the parent
TypeScript 6 checkout, client installation, all 12 tests including actual two-server
HTTP, build and indexed artifact verification:
[client CI](https://github.com/cordisx/plugin-game-room/actions/runs/34292959889/job/102283313451).
This supersedes earlier load-related local runner failures and the earlier SDK
preparation failure; no production runtime limits were changed.

The main-page revision adds a regression for delayed human authorization and
cancellation. Local formatting, source/CSS lint, typecheck, build, dry-run and all four
indexed runtime files pass. All 13 tests pass with zero skips against the immutable
server build `66adc014`, including the actual two-server HTTP scenario. Real HTTP is included by building the server and using:

```sh
GAME_ROOM_SERVER_MODULE="$PWD/dist/server/http.js" npm --prefix client test
```

Without the environment variable the real HTTP case is explicitly skipped.

Browser review uses the actual plugin and public Host HTTP/restrictedContent
brokers against a persistent local score-only service. Verified through the Host
masked input: connect `preview_player`, continue Join, confirm Ready, observe the
rule-based practice opponent start, play a white stone at column 9 / row 8, then
observe the opponent's black stone at column 8 / row 7 and authoritative move 3.
The practice opponent is explicitly labelled **not an AI model**. It uses neither
AgentLoop nor wallet funds. Credentials remain in Host capture and local secret
storage, never committed config or React state.

Independent browser review confirmed fixed lobby filters and Agent panel while
room results scroll. Responsive container corrections and complete final visual
review are tracked with the delivery evidence. Native installed-generation
lifecycle, real-model Agent dispatch and real-wallet funding remain separate
acceptance scopes; this browser record does not claim them.

The existing React peer range warning (`valtio` → `use-sync-external-store@1.2.0`
with React 19) is unchanged. Protocol, Channel and Proxy identities remain exact
and deduplicated; no local peer override or private Host fallback is introduced.
