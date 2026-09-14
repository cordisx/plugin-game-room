# Frame SDK index

The Host injects `globalThis.GameUI` into the isolated game frame. It is not an npm import and is not available in an arbitrary HTML page. See [the bundled types](frame-sdk.d.ts) for the exact shape. This revision includes the additive room-action API on bridge version 1; older Hosts may not expose it.

| API                                 | Use                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `version`                           | Current bridge version: 1. Also check additive methods/capabilities.                                  |
| `subscribe(listener)`               | Receive snapshots; returns an unsubscribe function.                                                   |
| `action(payload)`                   | Submit a game-defined move while `canAct` and not `readOnly`.                                         |
| `requestRoomAction('ready')`        | Prepare the current player's seat.                                                                    |
| `requestRoomAction('cancel-ready')` | Cancel the current player's preparation.                                                              |
| `requestRoomAction('start')`        | Request start when offered in `roomActions`.                                                          |
| `requestRoomAction('funding')`      | Request the existing Host funding flow; this does not directly reserve assets.                        |
| `requestNextRound()`                | Request next-round preparation when available.                                                        |
| `requestExit()`                     | Request Host-owned exit flow. The Game Room header already provides this entrance.                    |
| `reconnect()`                       | Request bridge reconnection, not a reset of the room. Normally use the Host synchronization entrance. |

## Snapshot and responses

A snapshot provides `matchId`, increasing `sequence`, game-defined `observation`, `status`, `canAct`, `readOnly`, `theme` (`light` or `dark`), and optional `roomActions`. The Host sets `document.documentElement.dataset.theme` before subscribers run. The current bridge does not inject full CSS color tokens. Define semantic foreground, muted, border and game-surface variables by this mode; keep the outer canvas transparent.

`roomActions` offers `ready`, `cancel-ready`, `start`, `funding`, and `next-round` as appropriate. Only render enabled lifecycle actions present in this list. A missing list or missing `requestRoomAction` means an older Host; show a concise unavailable state instead of calling a nonexistent API. A spectator does not acquire controls from another player's state.

Requests resolve with `status: accepted | rejected | uncertain`, optionally `code`. Accepted means the request was accepted; the next snapshot reconciles the displayed state. Uncertain means the outcome was not confirmed, not that the request definitely failed. Use the existing shared client retry/reconciliation path rather than blindly resubmitting a different move. The transport owns request IDs, sequence, duplicate handling and disposal; game authors should not implement raw postMessage protocols or request signing.

For ready/unready, immediately change only the local player's visual state, mark the request pending, and avoid duplicate clicks. Reconcile with the next snapshot. If rejected or uncertain, restore the last confirmed value and show an unobtrusive retry. Do not optimistically mark other players ready or start the game before its snapshot arrives.

## Minimal subscription

```js
const sdk = globalThis.GameUI
const unsubscribe = sdk.subscribe(snapshot => {
  // Render only this seat's observation and offered operations.
  render(snapshot)
})
window.addEventListener('pagehide', unsubscribe, { once: true })
```

Before offering preparation:

```js
const canPrepare = !snapshot.readOnly
  && typeof sdk.requestRoomAction === 'function'
  && snapshot.roomActions?.includes('ready')
```

Do not discard a whole iframe just to repaint state. Clean up subscriptions, timers and listeners when the game UI is disposed.

## Package and configuration entry points

In a Game Room checkout:

- `sdk/index.ts`: Manifest, package, rule context and transition types. `manifest.minimumViewport` describes the minimum useful width/height for responsive room layout.
- `sdk/html-ui.d.mts` and `sdk/html-ui.mjs`: HTML asset format and verification. Allowed assets are HTML, CSS, JavaScript and SVG; entry paths and resource limits are validated.
- `sdk/game-config.d.mts` and `sdk/game-config.mjs`: supported game configuration schema interpretation. Use the installed supported subset.
- `games/ui/common.js`: prepared integration of snapshot rendering, optimistic preparation, operation feedback and lifecycle cleanup.
- `games/tools/package.mjs`: deterministic builder. In the games workspace, `npm run build -- gomoku` builds an example; `npm run validate -- <package.json>` runs QuickJS package validation.

The host-owned TypeScript contract is `@cordisx/protocol/isolated-game-ui/v1`. Game rules run in server QuickJS; the UI runs in the browser frame. Do not confuse package validation functions with in-frame SDK methods. For a new game, follow the actual current package builder and update version/resources consistently rather than editing a generated artifact by hand.
