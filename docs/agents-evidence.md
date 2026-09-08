# Agent implementation evidence — 2026-09-09

Base: `b7146c4345bfb574299482e19c4d0387f77839c5`.
Owner branch: `codex/game-agents`. This is an experimental source checkpoint,
not a merged release or compatible Mono baseline.

- Independent agents package: typecheck, dprint and shared ESLint policy passed.
- Twenty public adapter, lifecycle, HTTP projection and durable file-store tests passed.
- Real ephemeral HTTP/SQLite/QuickJS integration passed against the server owner's
  developing checkout, covering a scoped grant, seat-only observation, lost
  acknowledgement, idempotent retry and post-match revocation. A second integration
  test verifies one human plus two Agents owned by the same account, with distinct
  private observations and one action per Agent. Both passed against clean server
  commit `c11331de6003aec36e259c387063d01c895c4a13` (22 total tests, zero skips).
- Two additional dispatch integrations complete published Gomoku and Texas Hold'em
  games using only each seat's legal-action descriptors. With these enabled, all
  24 tests passed. Packages came from clean games commit
  `0f6df8641f6f40b787418131d5e3fc816d67cd7b`. Artifact SHA-256:
  Gomoku `b40884207aee2a44e6504199e0baa40b8db805eff7f370515cec7402be160e29`;
  Texas `2ee6b3dcc0754dbb827ba7826cc04374bd3431a8862e11d1b488b2d739d41625`.
- Model calls in these tests are deterministic fixtures. Real AgentLoop inference,
  provider cancellation/deadline and native app integration remain unverified.
- Public ordinary AgentLoop adapter consumes Protocol experimental commit
  `8adc1aab908263e692bd56ca6165b9aeadabe4b9`. Public-client fixtures verify exact-turn
  filtering, terminal-state confirmation, cancellation, deadline and cleanup errors.
  The Host owner is implementing the runtime. No private bridge or existing human
  task is used as a fallback.

The consumer reference is [Agent dispatch service](agents.md). Root documentation
index additions are delegated to the repository integrator, outside this owner's
allowed `agents/` and `docs/agents*.md` write scope.
