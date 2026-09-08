# Integrated acceptance

This document names cross-component checks. Owner unit checks are necessary but
are not substitutes for this live acceptance surface. Use isolated accounts and
databases, never existing user assets or running previews.

## Execution matrix

| Scenario | Required observation |
| --- | --- |
| Two independent server sources | A room from each is visible; one unavailable source does not erase or block the other |
| Source identity change | Same URL with a different serverId requires explicit reconnection, not silent account/cache reuse |
| User-authored Gomoku | Publish package, create room, second account joins, legal moves finish; no core edit or extra plugin install |
| Immutable version | Changed content under the same publisher/game/version is rejected; ongoing match retains exact digest |
| Move retry | Lost-response retry of the same action changes state once; changed payload with same key conflicts |
| Hidden-information Hold’em | Each player and replay sees only own cards and public state; seed/deck are never in transport |
| Runtime abuse | Infinite loop, memory blowup, oversized output and unavailable host functions fail closed without wallet change |
| Token agreement | Every player confirms exact terms; room server cannot consent on their behalf |
| Token settlement | Bank balance is conserved; retry/cancel/timeout/crash have one terminal outcome |
| New match | Same room returns to ready; fresh match identity and agreement; old settlement/replay stays immutable |
| User-game Token mode | An unreviewed version may be used after disclosure; no hidden allowlist restriction |
| Agent dispatch | Distinct owner/server/room/seat context; ordinary AgentLoop model move is validated by game server |
| Agent cancellation | Late model output cannot mutate a revoked seat; real cancellation is distinguished from stopped waiting |
| UI sandbox | Uploaded UI gets bounded observation/action only, not session tokens, wallet, same-origin or Host access |
| Game-to-Pet spending | A completed game payout can purchase one Pet item, including retry/reload recovery |
| Pet migration | Isolated old save can be enrolled once; repeat import never creates another grant; local backup preserved |
| Self-host install | Fresh installation starts a new independent source using documented settings |

## Evidence

Record exact owner commit/tree, process cwd and port, effective config/entry,
package versions, test command/results and preview data origin. Native Host
claims require an isolated real app; browser component preview and fake-model
lifecycle tests do not prove native or live-model completion.

Current state: checks are planned, not passed. Merged revisions and final user
acceptance are separate milestones.
