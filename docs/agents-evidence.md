# Agent implementation evidence — 2026-09-09

Base: `b7146c4345bfb574299482e19c4d0387f77839c5`.
Owner branch: `codex/game-agents`. This is an experimental source checkpoint,
not a merged release or compatible Mono baseline.

- Independent agents package: typecheck, dprint and shared ESLint policy passed.
- Clean sibling `file:../agents` consumption uses `install-links=true` and installs
  Protocol as a production dependency. The consumer smoke copies source without
  any owner `node_modules`, installs, removes installed packages, performs frozen
  `npm ci`, and typechecks the public API with `skipLibCheck: false`.
- Twenty-five public adapter, lifecycle, usage-policy, HTTP projection and durable file-store tests passed.
- Real ephemeral HTTP/SQLite/QuickJS integration passed against an independent
  checkout of the scene-v1 server, covering a scoped grant, seat-only observation, lost
  acknowledgement, idempotent retry and post-match revocation. A second integration
  test verifies one human plus two Agents owned by the same account, with distinct
  private observations and one action per Agent. Both passed against clean server
  commit `88155a87cfd55949796714fa9a2f8138d1425cbb` (27 total tests, zero skips).
- Two additional dispatch integrations complete published Gomoku and Texas Hold'em
  games using only each seat's legal-action descriptors. With these enabled, all
  29 tests passed. Packages were rebuilt in an independent clean checkout of games commit
  `87699cd0bf3e777ece8769a0f20d6b1c9bf239e3`. Tests explicitly require `ui.format: scene-v1`.
  Canonical package SHA-256 (server content identities):
  Gomoku `5334c0de4febbc54f7634aad335f8911ce2530be170b7e9c9170eeb36df58c67`;
  Texas `faea944e4ea7a689cde960f976d380bf928d96b2e55e815b007c6805e61cf386`.
- Model calls in these tests are deterministic fixtures. Real AgentLoop inference,
  provider cancellation/deadline and native app integration remain unverified.
- Public ordinary AgentLoop adapter consumes Protocol experimental commit
  `465c444c65eec1be8e337b94c2cf658ed536f49c`. Public-client fixtures verify controlled
  game-directory creation (no legacy fallback), exact-turn
  filtering, terminal-state confirmation, cancellation, deadline and cleanup errors.
  The Host owner is implementing the runtime. No private bridge or existing human
  task is used as a fallback.
- Work-usage policy checks reject v1, missing/mismatched classification and any
  scope/source/epoch without a reward-owner-adopted v2 baseline. A dynamic policy
  callback is reevaluated before every inference. These checks do not prove another
  plugin's reward migration or runtime usage attribution; those remain owner evidence.

The consumer reference is [Agent dispatch service](agents.md). Root documentation
index additions are delegated to the repository integrator, outside this owner's
allowed `agents/` and `docs/agents*.md` write scope.
