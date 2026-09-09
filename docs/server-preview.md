# Real local demo preview

This operator recipe starts a real authoritative server with persistent isolated
SQLite, actual scene-v1 Gomoku/Hold'em packages, and two test accounts. It does not
connect to an economy or a model. The initialization verifier submits deterministic
HTTP actions as those two accounts; it is not presented as an AI opponent. The
initial rooms support two manual sessions; the optional practice runner below
provides a simpler single-user preview path through the same real API.

## Prepare an isolated runtime

Run from this repository with Node 24.14+. Inspect existing listeners before
choosing a free loopback port; never replace another task's process.

```sh
lsof -nP -iTCP:8790 -sTCP:LISTEN
npm ci
npm run build
umask 077
mkdir -p .data/live-preview/runtime/dist .data/live-preview/packages
cp package.json package-lock.json .data/live-preview/runtime/
cp -R dist/server dist/sdk .data/live-preview/runtime/dist/
npm ci --prefix .data/live-preview/runtime --omit=dev --ignore-scripts
```

The runtime snapshot prevents later checkout/build changes from altering running
guest workers. Copy the built `gomoku-1.0.0.json` and `texas-holdem-1.0.0.json` from
the game owner's distribution into `.data/live-preview/packages/`. Record their
owning revision along with the server revision. Do not edit package content during
initialization; normal immutable version/hash rules still apply.

Create `.data/live-preview/launch-config.json` with your actual preview origins:

```json
{
  "port": 8790,
  "bindHost": "127.0.0.1",
  "allowedOrigins": ["http://127.0.0.1:43129", "http://127.0.0.1:43130"],
  "serverRevision": "record-the-exact-built-server-commit",
  "gameRevision": "record-the-exact-game-package-source-commit",
  "mode": "score-only",
  "economyConnected": false
}
```

```sh
node deploy/demo-start.mjs .data/live-preview
curl --fail http://127.0.0.1:8790/health
node deploy/demo-init.mjs http://127.0.0.1:8790 .data/live-preview .data/live-preview/packages
```

The starter rejects an occupied port and explicitly clears all economic connection
settings, including any inherited environment values. It records its own PID and
writes output only to `server.log`. Its launch response is not a health assertion;
the health request and initializer verify the running process. Keep the database,
WAL and runtime directory intact when restarting.

## Optional rules practice opponent

For continuous single-user review, run this **after** initialization:

```sh
node deploy/demo-practice.mjs init .data/live-preview
node deploy/demo-practice.mjs run .data/live-preview
```

Keep the second command running in its own terminal (or launch it as an explicitly
managed local preview process). It uses a separate mode-0600
`practice-credential.json` containing only the opponent account's bearer, and an
explicit `practice-config.json` list of managed room IDs. It never reads the human
preview account's credential, another seat's observation, private game state or the
SQLite database. No model, formal AgentLoop, shared Token or wallet is involved.

New rooms are named **规则练习对手（非AI模型）** and advertised through
`public-config.joinableRooms`. The initializer retires only untouched manual rooms
with the opponent as their sole seat; already-joined review rooms remain intact.
The main game-server process and its database are not restarted or replaced.

The preview user joins and readies one practice room. The process readies its own
seat, starts once both are ready, and submits only server-authorized actions from
its own observation. Gomoku uses fixed win/block/center-first priorities; Hold'em
checks/calls where legal. These are explicitly disclosed practice rules, not model
inference or fabricated game results. Server rules and version/idempotency checks
remain authoritative. After a terminal result, the process waits 15 seconds,
requests next-match and readies its seat; the user readies again for the next game.
It refuses non-score rooms and a server with an economic connection.

For an independent real-HTTP verification, use separate verifier rooms; never
submit moves or reset the room currently being used by a reviewer. The supplied
preview's verification records distinguish the deterministic initializer games
from the continuously running practice opponent.

## Credentials and real room flow

The initializer generates random passwords, registers `preview_player` and
`preview_opponent`, and writes `credentials.json` with mode 0600 inside the 0700
state directory. Entries are `accounts:[{role,name,accountId,password,token}]`.
Never copy this file into Git, messages, React state/config or localStorage. For
native previews, import/capture the selected bearer through the Host's masked,
scoped credential flow. It remains a test credential with access only to this
isolated game server; there is no connected wallet.

`public-config.json` contains no secrets: source configurations, account IDs,
package hashes, joinable room IDs and completed verification summaries. Each source
has `{id:serverId,name,url,accountId,enabled:true}`. Use separate account contexts or
browser windows with their appropriate secure credential transport.

For the manual two-window path (without the practice runner):

1. In the preview-player window, connect the real source and join a room listed in
   `joinableRooms`, then ready that seat.
2. In the opponent window, connect as `preview_opponent`. That account created the
   room and is already ready; open the same room and start after both seats ready.
3. Play each turn from its owning account's window. Gomoku cells and Hold'em
   actions come from actual server scenes. Turn timeout is ten minutes for review.
4. After finishing, the creator can request next-match and both seats ready again.

Two completed verifier rooms are deliberately separate from the waiting review
rooms. The verifier runs a full nine-action Gomoku game and a check/call Hold'em
hand to showdown, checks hidden opponent cards during play, retries each action
idempotently, and requires `finished` with `settlement:none`. Summaries are persisted
in `public-config.verification`. This is real HTTP/SQLite/WASM execution evidence;
it does not claim native browser clicks or model inference.

Rerunning initialization reuses the same credentials, immutable packages and
recorded rooms. It never resets a room a reviewer may have joined. If passwords or
tokens must be replaced, use the normal account/session API and keep the handoff
file private. Token room creation remains unavailable while no economy is connected.

## Stop or restart only this preview

Stop the optional practice process first with SIGTERM after verifying its exact
command and recorded PID. It exits after its current API call; leave the server
running if review should continue manually.

Inspect `server.pid` and verify that process runs the snapshot's
`runtime/dist/server/main.js` before sending SIGTERM. Do not kill a process merely
because it owns the desired port. Stop only the verified demo PID, retain the data,
and rerun `demo-start.mjs`; serverId/accounts/history survive. If another task owns
a listener, choose a different free port and update the launch/source configuration.
