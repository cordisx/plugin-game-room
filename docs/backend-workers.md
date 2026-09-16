# Workers backend deployment

This adapter runs the Game HTTP API on a Workers-compatible host with one D1
binding named `DB`. It does not move the native wallet, connect to an operator's
loopback Economy service, or provision managed-account signing keys. Registered
accounts can play score and local-chip matches. Token matches remain unavailable
without a persistent operator-provisioned Game spend key and origin; see
[local wallet spend](local-wallet-spend.md).

Install the exact lockfile with `npm ci`, then run `npm run build:workers`. The
entry point is `dist/server/index.js`; retain `dist/server/quickjs.wasm` beside it
as a compiled WebAssembly module. Enable `nodejs_compat` with compatibility date
`2026-07-30` or newer. The build selects the Workers rules implementation; the
existing Node server continues to use its separate thread-based implementation.

Apply all ordered SQL migrations in `server/workers/migrations/` through the deployment
host's Drizzle migration workflow before starting the service. The migration
journal and snapshot are in the adjacent `meta` directory. Schema definitions
live in `deploy/workers-schema.ts`; regenerate migrations with `npm run
db:generate`. The request handler never creates or alters tables. A fresh D1
instance establishes one persistent server ID using `INSERT OR IGNORE` and a
primary read. Do not replace that ID when restarting or redeploying.

`AUTH_POLICY` defaults to `login-required`; explicitly use `guest-allowed` to
allow guest sessions. `ALLOWED_ORIGINS` is an optional comma-separated list of
browser origins. Authentication rate buckets persist in D1. A hosting gateway's
private access credential is separate from the Game bearer token; a successful
gateway smoke test does not establish connectivity from a native plugin.

Critical D1 reads use `first-primary`. A mutation reads only its required rows,
stages its actual SQL writes, then submits one atomic batch containing read
checks, room state, event, command response and any Agent budget consumption.
Named SQL CHECK constraints abort the entire batch on a stale read or a zero-row
budget update. Concurrent retries return the committed command response. Each
write has a 1,900,000-byte UTF-8 budget, below the D1 row limit; oversized
projections return `422 persistence_limit` without truncation or partial writes.

Every uploaded rule/UI/bot invocation uses a fresh QuickJS runtime and context,
with 16 MiB guest memory, a 256 KiB stack, an interrupt budget of 1,000 callbacks
and the existing output limits. The budget also covers top-level source,
validation, getters and result serialization. No guest is retained across an
await. The compiled WASM module is shared within an isolate. Workers platform
CPU and memory limits form a separate availability boundary; they are not the
Node thread's wall-clock termination mechanism.

This target has no configured scheduler. Room requests perform at most eight
recovery/bot steps for the selected room. Polling or re-entering that room
advances expired turns and pending work. Rooms do not advance in the background
while no requests arrive. Do not claim scheduler parity with the Node timer.

Run `npm test`, `npm run test:production` and `npm run test:workers` before
publishing. Workers tests exercise real workerd/D1 concurrency, SQL rollback,
malicious guest failures, persistent rate limits, oversized eight-seat
projections, and complete current Gomoku/Holdem matches. Verify health,
handshake, persistence, private projections and the hosting gateway separately
on the published deployment. Local verification is not online acceptance.
