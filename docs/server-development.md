# Server development and self-hosting

Requires Node.js >=24.14 (node:sqlite and worker type stripping in development).
Install with `npm ci`; `npm run check` formats/checks maintained server/SDK/tests,
checks shared ESLint policy, compiles, runs behavioral tests, and builds to dist.
The root is a workspace host for future independent client/games/agents packages;
server TypeScript scope deliberately does not pull their build graphs in.

```sh
npm ci
npm run build
DATABASE_PATH=.data/game-room.sqlite PORT=8787 node dist/server/main.js
```

The default bind is 127.0.0.1. Configure `BIND_HOST` explicitly for container ingress.
A reverse proxy must terminate TLS outside loopback, bound request concurrency and
connections, and enforce an operator-appropriate publishing/account quota. Built-in
per-IP rate limits are 15 account/login requests/minute, 600 other requests/minute;
forwarded IP headers are deliberately not trusted. An internet operator should set
proxy limits for their real client address and scale before opening registration.

`ALLOWED_ORIGINS` is a comma-separated list of exact client origins. No wildcard or
cookies. Package HTML receives sandbox CSP independently. Sessions are sensitive:
client credential storage belongs to the client's secure transport, not game UI.

Optional shared Token economy configuration (all three required):

```sh
ECONOMY_URL=https://economy.example/
ECONOMY_SERVICE_ID=game-service
ECONOMY_SERVICE_TOKEN=operator-provisioned-service-credential
```

Inject the token from a deployment secret; never place it in client assets or Git.
Use one configured economic instance per game server. Account linking uses a
one-time proof, never a user economic session. See the [API](server-api.md).
Absent economic configuration is a working score/local-chips server and token
operations explicitly return unavailable.

## Persistence and recovery

SQLite WAL, FULL synchronous commits and atomic state/event/command writes provide
restart recovery. Store database **and WAL** on durable local storage. Keep one
active server process per database for operational simplicity; version CAS rejects
competing stale room commits but horizontal hosting and distributed locking are
not an established deployment mode. Startup resumes pending economic operations;
a one-second tick handles funding, timeout, settlement/refund. Never delete the
store to recover: it owns server identity, accounts, sessions, immutable packages,
room state/randomness, Agent grants, pending funding and replay history.

Use SQLite's online backup facility or stop the process cleanly before copying the
database files. Restore to an isolated server first; inspect `/health`, handshake
serverId, one authenticated historical replay and economic reconciliation before
switching traffic. Directory/files contain hidden cards and hashed credentials;
restrict OS access and use encrypted backups. New databases are mode 0600; default
data directory is 0700. No production migration from another schema is claimed.

## Runtime boundary and verification

Rules execute only in quickjs-emscripten 0.32.0 WASM, inside disposable Node workers.
They are never imported as trusted Node modules, never run with node:vm and never
receive Host APIs. QuickJS resource APIs used here are documented in its
[official runtime reference](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md).
The worker adds a wall-time kill switch. Admission validates required exports;
malicious runtime loops, allocation, excessive output, async results, imports and
non-platform capabilities have behavioral tests. Game-rule correctness and
fairness still require game-specific tests; arbitrary author code can intentionally
encode a biased game or reveal its own state through its observer.

The tests exercise real HTTP, actual WASM guest execution, SQLite recovery,
concurrent actions, seat isolation and economic adapter failure paths. They do not
claim production penetration testing, native Host acceptance or public deployment.

Sites is not a required dependency. This runtime needs a long-lived Node 24 process,
worker_threads, WASM loading and durable SQLite storage. No Sites adapter or verified
Sites runtime for those capabilities has been supplied in this repository. Therefore
this delivery provides self-hosting and does not claim a Sites deployment. A future
adapter must verify those requirements or implement a supported persistence/runtime
replacement before being advertised.
