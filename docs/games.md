# Example games

The [server API](server-api.md) and [SDK](../sdk/index.ts) own GamePackage v1.
These examples keep game knowledge inside uploaded packages. Their `ui.render`
functions run in a separate server QuickJS guest and return scene-v1 trees for
the trusted Host renderer; no author HTML or browser JavaScript is executed. The server executes
rules in fresh QuickJS runtimes and is the only authority for actions and results.

- [Build, validate and publish a package](games-authoring.md)
- [Source and local commands](../games/README.md)

## Gomoku 1.0.0

Two seats play on a 15 × 15 board. Seat 0 is black and moves first. A contiguous
line of at least five stones horizontally, vertically or diagonally wins. This
is freestyle Gomoku: no forbidden black moves or exact-five restriction. A full
board with no line is a draw. A timeout loses immediately. Configuration is empty.

An action is `{type:"place",x:0,y:0}` using zero-based integer coordinates. The
acting seat must equal `turn`, and the cell must be empty. Observation includes
`kind:"gomoku"`, `size`, `selfSeat`, `board` (225 cells, row major, `null | 0 | 1`),
`turn`, `moves`, `lastMove`, `result`, `reason` and `legalActions`. Only the acting
seat receives the list of currently legal placement objects. All board information
is public. `result.winners` is empty for a draw, otherwise contains one seat index.
Scores are 1 for a win and 0 otherwise. Token mode uses `equal-winners-v1`.

## Texas Hold'em 1.0.0

A match is one complete hand of no-limit Texas Hold'em for 2–8 seats, from shuffled
deal through preflop, flop, turn, river and settlement. Use the server’s `next-match` action in the same room, then ready all seats again,
for another hand. This package does not implement a persistent tournament.

Every seat begins with equal chips. In score/local-chips mode `config.initialStack`
defaults to 1000; in token mode the initial stack is always the platform's trusted
`ctx.stake`, and `config.initialStack` has no effect. Initial stacks are safe
integers from 2 through 1,000,000,000. `config.bigBlind` defaults to
`max(2,floor(initialStack/50))`; `config.smallBlind` defaults to half the big blind,
rounded down with a minimum of 1. Small blind must be below big blind, and big
blind cannot exceed the initial stack. There are no antes, fees or rake.

The button and Fisher–Yates deck shuffle use only `ctx.random`. Cards are dealt
clockwise starting left of the button, two rounds; a card is burned before each
public street. Heads-up, the button posts small blind, acts first preflop, and
acts last after the flop. With more players, the two seats left of the button
post blinds; the seat after the big blind acts first preflop.

### Actions and observations

Only the current seat receives `legalActions`; other seats receive `[]`.

| Legal action descriptor      | Submitted action            | Meaning                                        |
| ---------------------------- | --------------------------- | ---------------------------------------------- |
| `{type:"fold"}`              | `{type:"fold"}`             | Give up this hand                              |
| `{type:"check"}`             | `{type:"check"}`            | No additional wager owed                       |
| `{type:"call",amount}`       | `{type:"call"}`             | Pay the outstanding wager, capped at own stack |
| `{type:"raise",minTo,maxTo}` | `{type:"raise",to:integer}` | Set this street's total contribution to `to`   |
| `{type:"all-in",to}`         | `{type:"all-in"}`           | Wager the entire remaining stack, when legal   |

`to` is the total wager on the current street, not the increment or the match's
cumulative contribution. Descriptors are hints; `act` independently recomputes
legality. Invalid actions throw `invalid_action` without committing a transition.
Timeout checks if free, otherwise folds.

The minimum raise increment is the last full bet/raise, initially the big blind
on every street. Short all-in increases update the amount owed without reducing
the minimum raise. A seat that already acted regains raise rights only after
facing at least one full increment, including cumulative short all-ins. A lone
player with chips can only answer an outstanding wager against all-in opponents;
after that, remaining public cards run out automatically. These betting semantics
were checked against the [Poker TDA rules and examples](https://www.pokertda.com/view-poker-tda-rules/).

Observation contains `kind:"holdem"`, `selfSeat`, `turn`, `street`, `button`, blind
seats/amounts, `board`, `pot`, `currentBet`, `players`, `legalActions`, `lastAction`,
`pots` and `result`. Each player has `seat,stack,bet,total,folded,allIn,hole`.
Card IDs are `suit*13+rankIndex`: suits `spades,hearts,diamonds,clubs` and ranks
`2,3,4,5,6,7,8,9,T,J,Q,K,A`. Hidden cards are `[null,null]`. During play, only the
requesting seat's hole cards appear. At showdown, live hands are public; folded
hands remain private to their owners. Uncontested wins reveal no opponent hands.
The deck, burns, random seed and private state never appear in observations.

### Pots and settlement

The evaluator chooses the best five of seven cards. Aces play high or low in
straights; suits never break a tie. Contribution levels form independent main and
side pots. Folded contributions remain in pots but folded seats are ineligible.
A layer with one contributor is an uncalled wager returned to that contributor.
Tied winners split each pot; odd chips are awarded clockwise starting left of the
button. `pots` records amounts, eligible seats, winning seats and refunds.

`conserved-payouts-v1` is the declared settlement policy. `result.payouts` contains
final stacks in seat order; their sum equals the initial total. Scores are each
seat's final stack minus its initial stack; `winners` identifies seats awarded a
contested pot. The server validates and applies conserved payouts from escrow.
Neither the game UI nor rules can mint chips, call wallet methods or settle money.

The rules and evaluator are original code under the repository's MIT license.
No code from dsh-all-in is incorporated, so no copied third-party snapshot or
upstream modification record is shipped.
