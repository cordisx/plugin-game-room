# Server development and self-hosting

Requires Node.js >=24.14 (node:sqlite and worker type stripping in development).
Install with `npm ci`; `npm run check` formats/checks maintained server/SDK/tests,
checks shared ESLint policy, compiles, runs behavioral tests, and builds to dist.
The root owns server dependencies and only the `packages/*` workspace namespace.
Client/games/agents remain independent packages with their own locks; use their
explicit `npm --prefix <directory>` commands. Server TypeScript deliberately does
not pull their build graphs in.

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
cookies. Uploaded UI is a server-side WASM render function; clients receive only
validated declarative scenes, never author HTML or JavaScript. Sessions are sensitive:
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

## Deployment artifacts

`deploy/Dockerfile` is a two-stage Node build, runtime dependencies only and an
unprivileged runtime user. `deploy/compose.yaml` binds ingress only on loopback,
uses a persistent named data volume and drops container capabilities. From the
repository root, operators may run:

```sh
docker compose -f deploy/compose.yaml config
docker compose -f deploy/compose.yaml up --build -d
```

Set the environment shown above before starting; empty economic settings leave
Token unavailable. TLS ingress is a separate operator responsibility. The supplied
systemd unit assumes a `game-room` service account, built application at
`/opt/game-room`, Node at `/usr/bin/node`, and mode-0600 `/etc/game-room.env`.
Review these paths before installation. This task does not install the unit,
start containers or modify existing services.

Container build/runtime is unverified in this development environment: Docker CLI
is installed, but `docker version` reports it cannot connect to the Colima daemon.
Compose syntax is checked offline with the installed standalone `docker-compose`
CLI; the Docker Compose subcommand is not installed here. The compiled Node entry and production
runtime dependencies are smoke-tested separately; that is not a Docker runtime test.

Economic identity is pinned on first successful link as instanceId + serviceId +
canonical URL, persisted separately from credentials and copied into token rooms.
Changing any component returns `economy_instance_changed`; credential rotation for
the same identity is possible, but switching currency instances is not an implicit
migration. Use a separately initialized game-server identity for another economy,
or implement an explicit audited migration before reusing account links. Agreement
reads and settlement acknowledgements must match pinned identity and terms; server
also checks the economic settled payout record against its requested allocation.
An unexpected already-settled agreement without a matching game settlement remains
pending for operator investigation; it is never labelled refunded or successful.

The installed CI workflow is `.github/workflows/server.yml`; it runs the full
owner gate and a Docker build on Linux. The initial HTTPS OAuth push was refused
because that credential lacks workflow permission. Existing authorized SSH access
is used to publish the workflow; origin remains HTTPS and no credential change is
needed. Local Docker runtime remains unavailable as recorded above.
