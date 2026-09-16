# Architecture checkpoint — 2026-09-09

The new requested Token pool and multi-hand target is described in [Token 抵押对局](token-pool-games.md). It supersedes the fee-only product goal below, and has an isolated implementation candidate; production migration is not complete. Existing transactions retain their original protocol.

## User-approved scope

The source requirement is manager task 01a08270-8be3-7fa3-a46d-c47e67efd2f1. The user authorized full implementation and independent parallel tasks.
This is a turn-based game platform, not a hard-coded poker app. Users publish versioned game UI and rule packages, create rooms, and friends load the same game without installing a dedicated CordisX plugin. Server-authoritative execution; no local authoritative alternate mode.
Multiple independently hosted servers are simultaneous data sources. The lobby aggregates room cards and filters by game/source/vacancy/Agent allowance. No global current-server context. Scope identity by server and account; pin game and protocol versions per match.
Top-level navigation: lobby, my Agents, dispatch center. History belongs in personal pages; data-source management belongs in settings. Match the native Host header. No separate game-selection tile section, no duplicate active-Agent banner above the right Agent panel.
An Agent can be dispatched to someone else's room using an isolated seat context through AgentLoop. Agents are declared, scoped and budgeted; cannot read another seat or call wallet mutation arbitrarily.
Modes: score-only, match-local chips, shared entertainment Token coins. These coins are virtual; no fiat, deposits or cash withdrawals. Unreviewed user games MAY use Token coins after explicit version/rules/review-state/stake/result-policy disclosure and join consent. Review status is descriptive, not a mandatory allowlist. Runtime safety and escrow bounds always apply.
Game author code cannot create Token income. New Token matches charge each participant their own authorized fee; Game results use scores or match-local chips. Game signs terms and durable capture/refund decisions, and the public Host capability bridges to one original local wallet. See [local wallet spend](local-wallet-spend.md). This supersedes the earlier conserved winner-allocation model.
Initial acceptance: Gomoku and Texas Hold'em; open and hidden information; rule package versioning, client isolation, two-user join, resume, timeout, replay, Agent dispatch, multi-source compatibility and Token-to-Pet spending. Self-hosting is first-class; Sites is a conditional deployment adapter, not a core dependency.

## Ownership

Manager owns cross-repository coordination and integration. Product owners modify only assigned directories. Public Host-contract gaps go through cordisx-protocol then Host; business game protocols stay here. Do not change another checkout or existing user preview.

## Delivery status

This is the agreed architecture input, not proof of implementation, runtime support or user acceptance.

## Configuration reference

See [game configuration](game-configuration.md) for package-declared configuration,
shared rendering and server-side validation.

## Source access and game identity

The trusted client selects the guest connection path from the server's actual
`/v1/handshake` declaration `access.guests`, rather than trusting a local URL or
an “official” name. Guest-capable sources use a credential-free public grant
and the server-issued guest session exchange. An existing guest session is
restored and reused; connecting does not require a manually configured server
access key or imply login to a registered game account.

Sources with guest access disabled retain the explicit account-token connection
path. That token represents game-account authentication, not a universal server
access key. The current source panel does not implement the server's separate
username/password game-account login flow; it must not replace a guest session
with a generic bearer prompt or report guest connection as registered login.
An explicit account-mode call against a guest-capable source is rejected with
a clear explanation until that separate login UI is implemented.

## Personal data reads

The personal page reads the game server's authenticated `/v1/me` display profile
using the existing retained game-session scope. It restores only an existing
session; viewing the page never creates a guest, logs in or substitutes the Host
header identity for the game profile. Each source keeps its own account and
connection state. Source discovery completion refreshes personal resources so
an early request cannot leave a discovered wallet or profile hidden.

Game history uses `/v1/me/rooms` and includes only finished rooms. Current cards
do not provide a per-player outcome or completion timestamp, so the client must
not fabricate wins, scores or dates. Loading failures retain valid partial reads
with an error indication; unavailable, disconnected and genuine empty states
have separate explanations.

The global personal page shows the game profile above Overview, History and
Assets tabs. History combines connected sources and labels each record with its
source. Assets reserves the unique local wallet view. Missing or replaced canonical authority
shows unavailable; no per-source or isolated test wallet is used as fallback. Detailed ledger rows belong to the separate
`ledger` page (`/main/game-room/ledger`). The personal assets tab's entry and every
page's header balance navigate to this same Host route; Host renders the header and Back control; the plugin supplies the semantic parent
route, independent of visit history. Game subpages include the game lobby root;
ledger and replay return to personal, and funding returns to the room. Only the detailed page requests ledger rows, rather than scrolling
to a section inside the personal page.

Economic assets are independent of remote Game identity. Only the public original
local wallet provider supplies balances and ledger entries. Multiple remote sources
and accounts consume that same wallet without creating alias balances. Transferring
between available and reserved is a hold/release, not income. Detailed behavior is
in [local wallet spend](local-wallet-spend.md).
