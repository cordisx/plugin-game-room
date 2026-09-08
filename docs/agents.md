# Agent dispatch service

This package owns player profiles, seat dispatch and its local execution lifecycle.
The server owns authorization and game state; see [server API](server-api.md).
Profiles select supported game IDs, personality and a fixed model. Each dispatch
uses a unique ID and the exact server, room, seat and owning account. Multiple
Agent seats can belong to the same account, with independent dispatch contexts.
A grant also fixes `matchId`: a subsequent match requires fresh authorization.

## Client integration

Import `createDispatchService` and types from `agents/index.ts`. Supply a provider
and `SeatTransport`. `createSeatHttpTransport` consumes a trusted
`AuthorizedSeatHttp` implementation that binds server origin and an opaque
credential reference, enforces response limits, cancellation and redirect denial.
The model never receives this transport, human session, grant token or wallet API.
Human authorization and grant capture belong in the client/Host credential flow.
Joining another person's room is supported when that room allows Agents.

`createAgentLoopProvider` accepts public `agentLoop` v4 and additive
`agentLoopControl` v1 clients, a `providerId`, `executionMode: 'ordinary'` and
`aggregateRewards: 'disabled-or-game-excluded'`. Missing control or unconfirmed
reward policy returns typed availability information. It creates an independent
task, uses the profile's fixed model with high effort, and subscribes to that exact
binding. An action is returned only after its matching completion event and
controlled-turn `read` both confirm completion. Abort and disposal call public
`cancel` with the exact controlled turn. Shared Host clients are not disposed.
The package pins the experimental Protocol commit
`8adc1aab908263e692bd56ca6165b9aeadabe4b9`; it is not a released Host capability.

`dispatch(input)` creates a dispatch and starts automatic polling. `get`, `list`
and `subscribe` expose cloned snapshots containing status and budgets, with no
observations, pending actions or credentials. `withdraw(id, 'immediate')` aborts
execution and revokes the grant. `withdraw(id, 'after-match')` continues this match
until the server reports finished/aborted, then revokes; in a waiting room it
withdraws before start. Withdrawal releases Agent control, not the server's
economic commitments or authoritative seat history. Server timeout policy handles
a withdrawn seat during play.

`pause` cancels the current turn but retains the grant and pending submission.
`resume` rechecks authoritative state. `close` cancels local work and disposes
provider contexts, preserving records for recovery. It does not dispose a shared
Host AgentLoop client. `restore` must run on an empty service with an exclusively
owned store. Manual `tick` is available for integration harnesses; normal clients
use automatic polling. Invoke `close` during plugin deactivation.

## Authority and bounded execution

Only the server's exact seat observation reaches the model. Game strings and
player text are untrusted data. The output is bounded JSON with exactly
`{requestId, version, action}`; mismatched requests, Markdown and extra fields are
rejected. The server revalidates the action. Pending actions are saved before
submission and replayed with the same idempotency key after a lost acknowledgement.
A stale version discards that pending action and reobserves the seat.
If the process exits during inference, its reserved call and Host deadline remain
in the record. Recovery waits out that deadline before another model call, avoiding
overlapping inference when the old turn's cancellation cannot be confirmed.

Action and model-call budgets are separate. A model call is reserved before
execution, including failed attempts. Dispatch duration and turn deadlines use
absolute wall time, so waking from sleep cannot grant extra time. Grant expiry
is another hard server bound. Retries are capped, and model output after abort,
replacement or deadline cannot become an action. Unknown model token usage remains
`null`; profile aggregate usage must never be presented as seat attribution.

Ordinary Agent execution uses a separate public AgentLoop task and the user's
existing provider permissions and approvals. Its workspace and tool privileges
are not a security sandbox. Prompt rules are behavioral guidance, not enforced
tool isolation. Strict data-only execution is an optional capability and must
return unavailable if the provider cannot enforce it. The adapter must use public
ordinary turn cancellation and Host-enforced deadlines; unsubscribing alone does
not cancel model work.

Game inference rewards are disabled (`rewardEnabled: false`), with no deferred
accrual. Before enabling ordinary play, the integrator must ensure any other
profile-aggregate Token reward source is paused or reliably excludes these turns.
The dispatch service cannot alter another plugin's economic policy.

## Recovery and verification

The default memory store survives network interruptions and local sleep while
the process remains alive. It does not promise recovery after process exit.
The Node-only `agents/file-store.ts` offers atomic fsync/rename persistence in an
owner-only directory with 0600 records and an exclusive writer lock. Keep it
outside the model workspace. Store only opaque credential references; protect
pending actions as seat-private data. Close the service before closing its store.
After an unclean crash a surviving writer lock is fail-closed: the trusted operator
must establish the previous writer is gone before removing that lock. Host plugin
integration must use a suitable protected persistence service; ordinary public
documents are not a credential or private-observation store.

If revocation fails, the service remains `withdrawing` and eventually
`paused` with `cleanup_pending`, never falsely `withdrawn`. Resume retries cleanup
without running another model turn. Automatic polling uses bounded retry counts;
an expired grant cannot acquire a replacement automatically.

Run `npm ci --prefix agents` and `npm run check --prefix agents` for the independent
package. A cross-owner source assembly can set `GAME_ROOM_SERVER_SOURCE` to the
server checkout and run `npm test --prefix agents`. That integration test uses a
real ephemeral HTTP server, SQLite and QuickJS game execution, with a deterministic
provider fixture. It proves transport/lifecycle behavior, not real AI inference,
native Host operation or user acceptance. See [Agent delivery evidence](agents-evidence.md).
