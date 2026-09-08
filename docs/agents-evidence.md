# Agent implementation evidence — 2026-09-09

Base: `b7146c4345bfb574299482e19c4d0387f77839c5`.
Owner branch: `codex/game-agents`. This is an experimental source checkpoint,
not a merged release or compatible Mono baseline.

- Independent agents package: typecheck, dprint and shared ESLint policy passed.
- Clean sibling `file:../agents` consumption uses `install-links=true` and installs
  Protocol as a production dependency. The consumer smoke copies source without
  any owner `node_modules`, installs, removes installed packages, performs frozen
  `npm ci`, and typechecks the public API with `skipLibCheck: false`.
- Twenty-two public adapter, lifecycle, HTTP projection and durable file-store tests passed.
- Real ephemeral HTTP/SQLite/QuickJS integration passed against an independent
  checkout of the scene-v1 server, covering a scoped grant, seat-only observation, lost
  acknowledgement, idempotent retry and post-match revocation. A second integration
  test verifies one human plus two Agents owned by the same account, with distinct
  private observations and one action per Agent. Both passed against clean server
  commit `88155a87cfd55949796714fa9a2f8138d1425cbb` (24 total tests, zero skips).
- Two additional dispatch integrations complete published Gomoku and Texas Hold'em
  games using only each seat's legal-action descriptors. With these enabled, all
  26 tests passed. Packages were rebuilt in an independent clean checkout of games commit
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
  The Host runtime checkpoint is `1d2636adbe239550fd70e3e82d4b43681a800833`
  ([draft PR 386](https://github.com/cordisx/cordisx/pull/386)). No private bridge or
  existing human task is used as a fallback.
- The Host owner reports a complete portable SDK build and a fresh ordinary npm
  consumer install without recursive Git preparation. This Agent lane independently
  verified the supplied tarball SHA-256 values:
  CLI `fbb47a38f3dc31b1db8ffd78b8b182dae1f01ed9de5c07c27f290af95e92a274`;
  Protocol `9576e28592b44c589aa847f3e57c02db1731a664c5cfa5a0f1fd5c4b5a3e21c8`.
  See the Host-owned [source packaging guide](https://github.com/cordisx/cordisx/blob/1d2636adbe239550fd70e3e82d4b43681a800833/.agents/docs/sdk-source-packaging.md)
  for the reproducible build and `sdk-evidence.json` inputs. The Host full gate was
  still running at this checkpoint; native and real-provider verification remain
  pending. Local cold installs and native runs are paused by resource coordination.
- A regression verifies ordinary Agent execution with no Pet, economy or usage
  service. Reward-ledger adoption is not a dispatch gate. Host owns game-directory
  classification; Pet owns its own work-v2 reward eligibility. This package cannot
  issue inference rewards, and seat token usage stays unknown.

The consumer reference is [Agent dispatch service](agents.md). Root documentation
index additions are delegated to the repository integrator, outside this owner's
allowed `agents/` and `docs/agents*.md` write scope.
