# Game Room HTTP v1 and GamePackage v1

Implemented experimental contract, owned by this repository. TypeScript exports:
[sdk/index.ts](../sdk/index.ts). Runtime and deployment:
[server development](server-development.md). No Host Protocol changes are implied.

All paths start `/v1`; JSON only, including immutable UI renderer source. Errors are
`{error:{code,message}}`; no stack or guest exception contents. Successful writes
return 200. Bearer credentials never appear in URLs. CORS is an explicit operator
allowlist, not authentication. Each configured source has its own URL and serverId.

## Discovery and authentication

- `GET /health` → `{ok:true}`.
- `GET /v1/handshake` → `{protocol:"game-room/1",serverId,gamePackageVersion:1,
  runtime:"quickjs-wasm",uiFormats:["scene-v1"],modes:["score","local-chips","token"],economyAvailable,
  economy:{url,gameServiceId,instanceId:string|null}|null}`.
- `POST /v1/accounts` `{name,password}` → `{account:{id,name},token}`.
- `POST /v1/sessions` `{name,password}` → same. Name 3–40 ASCII letters/digits,
  underscore/hyphen, case-insensitive; password 12–256 characters.
- `GET /v1/me` → `{account:{id,name,economyId?}}`.
- `DELETE /v1/session` revokes current session → `{revoked:true}`.

Accounts, rooms, matches, seats and grants have IDs
`${serverId}:<kind>:<uuid>`. serverId survives restart. Clients retain
source URL + serverId + account, never one global current server. Invitations
can encode source URL + serverId + roomId and verify handshake before joining.
Sessions expire in 30 days. Registration, login and public reads are unauthenticated;
all room seat operations and replay require an appropriate credential.

## Immutable packages and UI

`POST /v1/packages` (human session) publishes GamePackage v1. Response metadata:
`{hash,manifest,publisherId,reviewState:"unreviewed",uiUrl,uiSha256,uiFormat:"scene-v1"}`.
`GET /v1/packages` → `{packages:[metadata]}`;
`GET /v1/packages/:hash` → metadata. Hash is SHA-256 of recursively key-sorted
canonical JSON of the entire package. Publisher + manifest.id + version cannot
be overwritten with different content (`409 immutable_version`). Public endpoints
do not return rules source or private state.

```ts
interface GamePackage {
  packageVersion: 1
  manifest: {
    id: string // [a-z0-9-], 1..64
    version: string // three nonnegative integers separated by dots
    name: string // 1..100 characters
    minPlayers: number // 2..8
    maxPlayers: number // minPlayers..8
    modes: ('score' | 'local-chips' | 'token')[]
    settlementPolicies?: ('equal-winners-v1' | 'conserved-payouts-v1')[]
    description?: string
  }
  rules: string // <=256 KiB characters, classic JS assigning globalThis.game
  ui: { format: 'scene-v1'; render: string } // <=256 KiB classic JS source
}
```

Default settlementPolicies is `["equal-winners-v1"]`. Whole HTTP body max 600 KiB.
Publishing validates syntax, top-level resource use and four required entry points
inside QuickJS; it does not assert fairness or correctness of every configuration.

`GET /v1/packages/:hash/ui` returns immutable **JSON attachment**
`{format:"scene-v1",render:string}`, one-year cache and hash ETag. uiSha256 hashes
exact UTF-8 render source, separate from the whole-package hash. It is an immutable
authoring resource, never a script for clients to execute. Legacy `{html}` packages
are rejected; no HTML execution endpoint exists. This v1 is not yet released and
there is no legacy HTML compatibility path.

## Declarative scene UI

Author `ui.render` assigns `globalThis.render = (observation, context) => scene`.
Context contains exactly `{seatIndex,seatCount,mode,canAct}`. Each render runs in a
fresh QuickJS WASM guest/worker after the seat's rule observation. Its worker payload
has only renderer source, that seat's observation and this context: no rule source,
private state, seeds, accounts or credentials. No platform random callback is
registered. Native Date, random, network, filesystem, timers and WebRTC are absent.
CPU/memory/stack/wall bounds are the same as rules; UI output max 64 KiB UTF-8.

The server independently validates [Scene types and limits](../sdk/scene.ts):
`{version:1,root:Node}`. Node exact-key union:

- text: `{type:"text",text,tone?:"default"|"muted"|"accent"}`.
- stack: `{type:"stack",direction?:"vertical"|"horizontal",children:Node[]}`.
- grid: `{type:"grid",columns:1..19,children:Node[]}`.
- button: `{type:"button",label,action:Json,disabled?:boolean,ariaLabel?:string}`.
- number-action: `{type:"number-action",label,min,max,step,value,
  action:JsonObject,valueKey:string}`. Numeric fields must be safe integers,
  min <= value <= max, positive step, safe differences and `(value-min)%step===0`.
  valueKey is a single ASCII identifier up to 64 characters, never a property path.
  The trusted renderer copies the action and inserts the selected integer there.

Bounds: <=1024 nodes, root depth 1 / max 16, <=400 children per container,
text/labels/ariaLabel <=2048 characters, action <=4096 UTF-8 JSON bytes and depth
<=16. Numeric action templates and inserted boundary/default values must fit the
action byte bound; the renderer also revalidates actual submissions. Reject unknown
keys/types, sparse arrays, accessors, nonfinite numbers and recursive action keys
`__proto__`, `prototype`, `constructor`. There are no URL, raw HTML, style, image,
script or network primitives. A text string that resembles HTML remains plain text.

`RoomView.scene` contains only the current seat's validated tree, also persisted in
its replay/command ACK. A UI guest exception/resource limit (`ui_render_failed`),
invalid scene (`ui_scene_invalid`) or failed seat observation (`observation_failed`)
aborts the current match for every seat. All scenes become null with the failure
code in sceneError, the turn/deadline/result are cleared, and Token mode durably
requests cancellation/refund instead of settlement. Score/local-chips also end the
match. An author's valid scene displaying a business error is not a runtime failure.
Normal network disconnection does not invoke this failure path.

Projection completes before committing each authoritative transition, including
the final result, so a failed final scene cannot dispatch settlement. Economic
settled/refunded acknowledgements reuse the committed projection and never rerun
author UI after a funds operation. The failure reason persists through refund and
replay. Further actions/timeouts cannot advance an aborted match; exact command
retries return their original historical ACK without any new execution. Once the
refund is confirmed, next-match clears failure/readiness and creates new terms.
Before play, scene and sceneError are null. Clients pass the scene to the trusted
Host renderer as `{sequence:room.version,payload:room.scene}` and bind action events
to the authoritative source/room/seat/version. The client never loads renderer
JavaScript or forwards credentials into it. The renderer rejects stale/detached
controls and validates each emitted JSON action; the server still authorizes and
runs the rule's act method.

## Rule SDK

```ts
interface RuleContext {
  seats: string[] // fixed seat IDs in index order, never account IDs
  config: Json // immutable room input, max 16 KiB
  seatIndex: number | null
  mode: 'score' | 'local-chips' | 'token'
  stake: number // trusted per-seat stake; 0 outside token mode
  policy: 'equal-winners-v1' | 'conserved-payouts-v1'
  random(): number // platform stream [0,1), max 10,000 draws/invocation
}
interface Transition {
  state: Json // PRIVATE: persistence only, never a room response
  turn: number | null // index; null only with done
  done?: {
    winners: number[] // unique valid indices; [] for draw
    scores?: number[] // finite numbers, one per seat
    payouts?: number[] // conserved-payouts-v1 token final stacks
  }
}
// globalThis.game = {
//   setup(ctx): Transition,
//   act(state, action, ctx): Transition,
//   timeout(state, ctx): Transition,
//   observe(state, seatIndex, ctx): Json
// }
```

Synchronous JSON only. Fresh QuickJS WASM guest per invocation in a worker; no
imports, network, filesystem, process, Date, timers, native random or economy API.
16 MiB guest memory, 256 KiB stack, 100 ms interpreter deadline, 3 s whole worker
deadline, 256 KiB JSON-character output limit. The platform HMAC random stream is
persisted with state and cursor and never returned to clients. observe cannot draw
randomness. Runtime limit errors fail closed; a failed action does not advance the
random cursor. `Error("invalid_action")` rejects the action without mutation.
Other act execution errors reject; an invalid returned transition/result aborts.
Setup/timeout/observation failures abort. Observation failure returns null, never full state.

`observe` is the author-owned visibility policy. Recommended observation is an
object with `legalActions` containing JSON action templates; server always validates
by executing `act`. Isolation does not prove an author's rules fairly distribute
cards or keep secrets. Platform never broadcasts state, other observations, seeds
or private action bodies. Clients do not get a generic full-state fallback.

## Rooms and consecutive matches

`GET /v1/rooms` → `{rooms:[RoomCard]}`. `GET /v1/me/rooms` (human session) lists
rooms containing that account's seats, including finished history.
`POST /v1/rooms` creates a room and the caller's human seat:

```json
{
  "packageHash": "...",
  "mode": "score",
  "config": { "roomName": "Friends" },
  "maxPlayers": 2,
  "allowAgents": true,
  "turnTimeoutMs": 60000,
  "stake": 0,
  "policy": "equal-winners-v1"
}
```

Defaults: package maxPlayers, allowAgents false, 60-second turn, stake 0, first supported manifest policy (or equal-winners-v1). Turn timeout range 1 second–1 hour. Token stake positive integer <=1,000,000
per seat; other modes require 0. Match-local chips are game configuration/state and
never touch wallets. Config, packageHash, manifest, mode, stakes and policy remain
fixed in the room. A room keeps roomId but each round gets a fresh matchId/handNo.

Room mutations return `RoomView` unless specified. RoomCard fields:
`id,creatorAccountId,matchId,handNo,serverId,packageHash,manifest,mode,config,maxPlayers,allowAgents,
turnTimeoutMs,stake,policy,reviewState,status,version,seats,turn,deadline,result,
settlement,funding,economyIdentity`. RoomView adds `selfSeatId,observation,scene,sceneError`.
Status `waiting | funding | playing | finished | aborted`.
Settlement `none | pending | reserved | settled | refunded`.
Funding `{economyUrl,agreementId,termsHash}|null`; economyIdentity
`{instanceId,gameServiceId,url}|null` pins the currency source. Deadlines are Unix milliseconds.
Seat `{id,kind:"human"|"agent",participantId:string|null,accountId,name,ready}`;
accountId is the economic owner, not a unique seat identity.

- `POST /rooms/:id/join` `{consent?}` adds one human seat per account; retry returns it.
- `POST /rooms/:id/agent-seats` `{participantId,name,consent?}` adds a new Agent seat
  owned by the human caller. Requires waiting/allowAgents/capacity; same owner +
  participantId is idempotent. No human seat is necessary. Returns `{seat,view}`.
- `POST /rooms/:id/ready` `{ready:true,seatId?,consent?}` readies an owned seat.
- `POST /rooms/:id/leave` `{seatId?}` removes an owned waiting seat → `{left:true}`.
  Creator passes to a remaining owner; empty rooms abort. No in-game seat removal.
- `POST /rooms/:id/start` `{}` creator only, enough seats and every seat ready.
- `GET /rooms/:id?seatId=...` returns an owned seat's current view.
- `POST /rooms/:id/actions` `{expectedVersion,idempotencyKey,action}` controls the
  caller's human seat (or first owned seat when no human seat exists).
- `POST /rooms/:id/next-match` `{}` creator only after finished/aborted and explicit
  settled/refunded/none. Generates a new matchId, increments handNo, clears state,
  funding and readiness. Never reuses an escrow identity or random stream.
- `GET /rooms/:id/replay?seatId=...` → `{roomId,events:[{version,kind,at,view}]}`.
  Each event's view contains matchId. History includes successive matches and only
  the selected owned seat's recorded observations, never raw action/state/seed.

Optional seatId always checks owner. Default selects human seat, then first owned
seat. Each Agent should use its grant API instead of a human bearer. Nonmembers
receive 403 for views/replay. Versions increase monotonically across the room,
including next-match and economic status events. Exact action retries return the
original committed RoomView; idempotency is scoped to room + **seat**, persists
across restarts, and keys should be unique across matches. Different body under the
same key → 409 idempotency_conflict; stale version → 409 version_conflict; other
seat's turn → 403 not_your_turn. Expired turn rejects; server tick executes timeout.
Concurrent mutations serialize and commit state, replay, command ACK and grant
budget atomically. Each room commit also checks the expected persisted version.

## Token consent, linking and recovery

Token coins are virtual entertainment currency, with no fiat/cash paths. Unreviewed
packages are permitted. Creation/join/Agent-seat addition and ready require exact
`consent:{packageHash,stake,policy,reviewState:"unreviewed"}` for token mode.
Each human sees the game version/hash, review state, per-seat stake and policy.
Without economy configuration token creation fails 503 economy_unavailable.

The game server never receives the user's economic bearer. From handshake obtain
`economy.url` and `gameServiceId`. User contacts economy directly:
`POST /v1/link-proofs {gameServiceId,gameAccountId}` with their economy session and
Idempotency-Key. They send resulting short-lived opaque code to the game server:
`POST /v1/economy/link {code}`. Server redeems it using its own service credential,
verifies service/account audience, and saves only economic accountId. A `token`
field is rejected. A link cannot change while that owner has active token rooms;
two game accounts on one server cannot link the same economic account. First link
pins instanceId + serviceId + canonical URL persistently; mismatches return 409
economy_instance_changed, including reused account IDs after a server restart.

Starting token mode persists funding terms before creating the economic agreement.
All seats owned by one account aggregate into one participant's amount and
participantIds (seat IDs), included in economy termsHash. Each owner then explicitly
reserves through **economy's** `/v1/reserve {agreementId,termsHash}` with their own
session after seeing the total stake and covered seats. The game server cannot
reserve. It starts rules only after every participant reserved.

`equal-winners-v1` splits the entire pot equally among unique winners; remainder in
ascending seat order; empty winners return each stake. `conserved-payouts-v1` accepts
one nonnegative safe-integer final amount per seat and requires exact sum = total
escrow. These outputs aggregate per owner for settlement. Games never mint or
choose nonparticipant recipients. Economic agreements use a conserved-payouts
policy and bind game hash; the game platform additionally enforces the selected
room policy. The wallet discloses the server's allocation authority.

`server/economy.ts` adapts the economy owner's `/agreements`, `/agreements/:id`,
`/settle`, `/cancel`, `/link-proofs/redeem`. Creation/cancel/settle use distinct
stable matchId-based idempotency keys. Persisted pending operations retry after
outages or restart; economic failure never pretends success. Invalid runtime results
abort and request refunds, including partially reserved matches. Funding window is
10 minutes, match ceiling 23 hours, escrow expiry 24 hours from start request.
The economy is the authority for expired refunds; game never extends a term.

## Scoped Agent grants

`POST /rooms/:id/agent-grants` (human session)
`{seatId,expiresAt,maxActions}` →
`{grantId,token,serverId,roomId,matchId,seatId,accountId,expiresAt,maxActions}`.
Caller must own the exact seat, room allowAgents, match active, expiry <=24h and
budget 1..10,000 actions. Separate seats owned by one human get separate grants,
observations, replay entries, command scopes and budgets.

Only grant bearer authenticates:

- `GET /v1/agent/observation` → exact scoped seat's RoomView.
- `POST /v1/agent/actions` `{expectedVersion,idempotencyKey,action}` → that view.
- `POST /v1/agent/revoke` `{}` → `{revoked:true}`, idempotent even after expiry.

Human owner can `DELETE /rooms/:id/agent-grants/:grantId`. Revocation/expiry/next
match checks precede actions, including retries. Error codes: grant_revoked,
grant_expired, grant_scope_changed, grant_budget_exhausted (403), invalid_grant
(401). An exact accepted retry consumes no additional budget. Budget consumption
and room mutation commit together. Only token hash persists; lost tokens must be
revoked/reissued. Trusted Agent transport holds the token; model context never
receives it. A grant cannot authenticate human, package, replay or money endpoints.
