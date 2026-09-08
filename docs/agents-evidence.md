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
  The Host runtime checkpoint is `69b0146c4d4b6acd411758ae4ec3005ea74d0b89`
  ([draft PR 386](https://github.com/cordisx/cordisx/pull/386)). No private bridge or
  existing human task is used as a fallback.
- The Host owner reports a complete portable SDK build and a fresh ordinary npm
  consumer install without recursive Git preparation. This Agent lane independently
  verified the supplied tarball SHA-256 values:
  CLI `42f655ad735fd430e6f455bbb2e8da31f5eb564c247a3c31bbb1e9774df131c4`;
  Protocol `9576e28592b44c589aa847f3e57c02db1731a664c5cfa5a0f1fd5c4b5a3e21c8`.
  See the Host-owned [source packaging guide](https://github.com/cordisx/cordisx/blob/69b0146c4d4b6acd411758ae4ec3005ea74d0b89/.agents/docs/sdk-source-packaging.md)
  for the reproducible build and `sdk-evidence.json` inputs. The Host full gate was
  still running at this checkpoint; native and real-provider verification remain
  pending. This Agent lane also verified ordinary npm installation, full smoke-plugin
  typecheck, production build, a valid dependency tree with one shared Protocol
  instance, and `cordisx dev --dry-run` readiness against this SDK. The earlier SDK
  bundled a second Protocol instance and failed the real consumer's branded types;
  this checkpoint resolves that conflict without Agent source changes or casts.
  Native execution remains paused pending an unlocked Mac and the coordinated
  verification window. These preparation checks did not invoke a model.
- A regression verifies ordinary Agent execution with no Pet, economy or usage
  service. Reward-ledger adoption is not a dispatch gate. Host owns game-directory
  classification; Pet owns its own work-v2 reward eligibility. This package cannot
  issue inference rewards, and seat token usage stays unknown.

The consumer reference is [Agent dispatch service](agents.md). Root documentation
index additions are delegated to the repository integrator, outside this owner's
allowed `agents/` and `docs/agents*.md` write scope.
