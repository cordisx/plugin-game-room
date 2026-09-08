# Game Room HTTP v1 and GamePackage v1

Status: implementation contract for the first self-hosted server. Business protocol
owned here; no Host or CordisX Protocol change is implied. All requests and responses
are JSON except immutable UI HTML. Prefix `/v1`; errors are
`{error:{code,message}}`. Bearer session authentication is required except health,
handshake, registration/login, package listing/metadata/UI, and room listing.

## Identity, discovery and authentication

- `GET /health` → `{ok:true}`.
- `GET /v1/handshake` → `{protocol:"game-room/1",serverId,gamePackageVersion:1,
  runtime:"quickjs-wasm",modes:["score","local-chips","token"],economyAvailable}`.
- `POST /v1/accounts` `{name,password}` → `{account:{id,name},token}`.
- `POST /v1/sessions` `{name,password}` → same shape. Password min 12 characters.
- `GET /v1/me` → `{account:{id,name}}`; `DELETE /v1/session` revokes current token.

Account, room and seat IDs are `${serverId}:<kind>:<uuid>`. The serverId is a
persistent UUID. Clients must retain source URL + serverId + account; never
collapse multiple servers into one current-server identity. Package hashes are
content identities scoped by their source server. Sessions expire after 30 days.

## Packages and immutable UI

`POST /v1/packages` uploads a `GamePackage` below; authenticated publisher identity
is recorded. Response `{hash,manifest,publisherId,reviewState:"unreviewed",uiUrl}`.
`GET /v1/packages` → `{packages:[metadata]}`; `GET /v1/packages/:hash` → metadata.
`GET /v1/packages/:hash/ui` returns immutable HTML with sandbox CSP. Content hash
is SHA-256 of canonical recursively key-sorted JSON of the entire package.
Publisher + manifest.id + manifest.version is immutable; replacing the same version
with different content returns 409. Rules source and private room state are never
included in these public endpoints. UI must be self-contained and must run in a
sandboxed iframe without allow-same-origin. Parent bridge must allow only a seat
observation and validated action, never bearer tokens, Host bridges or wallet APIs.

```ts
interface GamePackage {
  packageVersion: 1;
  manifest: {
    id: string; // lowercase [a-z0-9-], 1..64
    version: string; // three nonnegative dot-separated integers
    name: string;
    minPlayers: number; // 2..8
    maxPlayers: number; // minPlayers..8
    modes: ("score" | "local-chips" | "token")[];
    description?: string;
  };
  rules: string; // classic JS script assigning globalThis.game
  ui: { html: string }; // self-contained HTML, no network dependencies
}
```

Guest entry points are synchronous and JSON-only. No imports, network, file,
process, Date, timers, native random or platform money functions are exposed.
The SDK type definitions in `sdk/index.ts` are the authoritative TS exports.

```ts
interface RuleContext {
  seats: string[]; // fixed seat IDs in index order
  config: Json; // fixed room config
  seatIndex: number | null; // acting / timed-out seat, null for setup
  random(): number; // platform deterministic stream, [0,1), never Math.random
}
interface Transition {
  state: Json; // PRIVATE, server persistence only
  turn: number | null;
  done?: { winners: number[]; scores?: number[] }; // no money values
}
// globalThis.game = {
//   setup(ctx): Transition,
//   act(state, action, ctx): Transition,
//   timeout(state, ctx): Transition,
//   observe(state, seatIndex, ctx): Json
// }
```

Invalid actions should throw `Error("invalid_action")`; all act exceptions reject
without advancing version or random stream. Resource failure on setup/timeout or
invalid transition aborts the match; reserved funds are refunded. Observation
exceptions fail closed and return no observation. Each invocation has a fresh
QuickJS runtime, 16 MiB guest memory, bounded stack, CPU deadline and JSON output
limit; host worker termination is a second time bound. Observations must implement
the game's visibility policy. Runtime isolation cannot prove that author-written
rules correctly conceal their own secrets; platform never substitutes full state.

## Rooms, seats and actions

`GET /v1/rooms` → `{rooms:[RoomCard]}` (no observations).
`POST /v1/rooms` body:

```json
{"packageHash":"...","mode":"score","config":{},"maxPlayers":2,
 "allowAgents":true,"turnTimeoutMs":60000,
 "stake":0,"consent":{"packageHash":"...","stake":0,
 "policy":"equal-winners-v1","reviewState":"unreviewed"}}
```

Response to room mutations/read is `RoomView`, not wrapped. It includes `id`,
`serverId`, `packageHash`, `manifest`, `mode`, `config`, `maxPlayers`, `allowAgents`,
`turnTimeoutMs`, `stake`, `policy`, `reviewState`, `status`, `version`, `seats`,
`turn`, `deadline`, `selfSeatId`, `observation`, `result`, `settlement`.
Status: `waiting | funding | playing | finished | aborted`.
Settlement: `none | pending | reserved | settled | refunded`.
Each seat: `{id,accountId,name,ready}`; turn is a seat index or null. Version starts
at 0 and advances on successful joins, ready changes, start, action and timeout.
A joined human controls its seat via account bearer. Nonmembers cannot read
RoomView or replay (403); all joined seats may resume using a new session.

- `POST /v1/rooms/:id/join` `{consent?:Consent}`. Idempotent for the same account.
- `POST /v1/rooms/:id/ready` `{ready:true}`. All seats must explicitly ready.
- `POST /v1/rooms/:id/start` `{}`. Creator only, minPlayers reached, all ready.
- `GET /v1/rooms/:id` retrieves the requesting seat's current observation.
- `POST /v1/rooms/:id/actions`
  `{expectedVersion:3,idempotencyKey:"unique-command-id",action:{...}}`.
  Only current turn seat. Exact retry returns the original acknowledged RoomView.
  Same key with different body is 409 `idempotency_conflict`. Stale version is
  409 `version_conflict`. Every action is serialized and committed atomically.
- `GET /v1/rooms/:id/replay` → `{roomId,events:[{version,kind,at,view:RoomView}]}`.
  Replays contain that requesting seat's recorded view only; never raw state,
  another seat's observation, seed, or private action payload.

Timeouts advance automatically on the server and also recover on restart. The
room is pinned permanently to exact packageHash, rules, config, stakes and policy.
A new package version cannot change an existing room. `local-chips` is explicitly
match-local, has no wallet effects; game config/observation carries its chips.

## Token consent and economic adapter

Token is virtual entertainment currency, no fiat. Unreviewed games are permitted.
For token mode, creator and each joiner must send exact Consent above; stake is a
positive safe integer, bounded by server policy. Clients present hash/version,
review state, stake and settlement policy before consent. Agents cannot invent
consent or call economy mutation. Score/local-chips never call the economy.
Without a configured adapter token room creation returns 503 `economy_unavailable`.

`EconomyAdapter` (`server/economy.ts`) performs trusted server-to-server calls:
`reserveMatch({operationId,matchId,packageHash,policy,stake,seats:[{seatId,accountId}]})`,
`settleMatch({operationId,matchId,payouts:[{accountId,amount}]})`,
`refundMatch({operationId,matchId})`. Each returns `{status:"applied"}`; no game
code receives this interface. Reserve is all-or-nothing across seats and escrow;
operations MUST be durable and idempotent by operationId, including after a lost
response. The adapter owns account mapping to the shared economy. The built-in
HTTP adapter uses `POST /v1/game-escrow/{reserve,settle,refund}` with service bearer.
An unavailable economy leaves an explicit durable pending operation for recovery;
never report a success or issue a second economically distinct operation.

The fixed equal-winners-v1 policy splits total escrow across unique winning seats;
integer remainder follows ascending seat index. Empty winners return each stake.
The server validates winners and scores; package code cannot choose arbitrary
payouts or mint. On runtime abort it requests refund (including reserve-response
ambiguity), never settlement. Economic outage does not erase the match result.

## UI bridge and Agent integration boundary

The server returns uiUrl in package metadata; clients resolve it against that
server's base URL. RoomView observations and actions are plain JSON. A separately
scoped Agent capability API may be added without changing human endpoints; do not
forward a human bearer into an Agent environment. Agent grants require owner
consent, exact room/seat scope, expiration and action budget. `allowAgents` is
metadata until that grant API is implemented; it is not authority to access seats.
