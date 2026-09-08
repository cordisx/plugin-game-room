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

## Reproducible economic integration

Build both repositories, then run from the game repository:

```sh
ECONOMY_REPOSITORY=/absolute/path/to/plugin-economy node --test integration/economy.test.mjs
```

This uses two real loopback HTTP services, SQLite databases and QuickJS. The
small four-seat game is an integration fixture, not the shipped game package.
It verifies one human and two owned Agent seats against a second human, one-time
account linking, aggregated consent and reservations, conserved payout, a shop
purchase with response retry, and a fresh match rejecting old Agent grants.
It also executes the author UI renderer in a separate guest and checks that its
scene contains only the selected seat's observation. It does not run a model,
draw the scene in a native Host or fulfill an item in Pet.

Observed passing on 2026-09-09 with game server
`88155a87cfd55949796714fa9a2f8138d1425cbb`, Agent package
`0df25226eb747bc8dc3f735d0c629003b544c4ac`, and economy
`2db025570fbe570d3964b2f2252ca7ff6e7fbb05`. This is component integration evidence;
native Host, final merged revisions and user acceptance remain separate gates.
