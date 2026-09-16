# Game interaction guidance

The game canvas should feel like part of the surrounding Codex page. Host owns the page background and navigation chrome; the game owns the board/table and its play controls.

When adding a game or revising its room artwork, also complete the
[artwork and detail presentation checklist](detail-presentation.md). It defines
the separate trusted metadata surface and its current package-contract limits.

## Layout

Use a transparent full-size root and responsive internal layout. Center the waiting board/table within usable space. During play, reserve room for the player's cards and action controls so they do not collide with seats. Keep enough space at small sizes for focus targets and card labels; do not shrink everything into unreadable thumbnails. Avoid decorative outer padding around the full-size game content. Preserve the board’s safe space for edge intersections. For a two-player board, place the current player below the board and the opponent above it using selfSeat; keep coordinates and rules unchanged. Without selfSeat, use a stable default orientation. Room details may consume width on a large window and overlay on a narrow one. Resizing should reflow the scene, not reset it.

The existing games use `minimumViewport` to advise the room layout. Choose dimensions based on usable content, not a favorite screenshot size. Avoid layout transitions that repeatedly rebuild the iframe or replay animations on every snapshot.

## Waiting and preparation

Show the game scene while waiting. Display actual public participants and readiness at their seats. The current player's seat owns icon-only ready/cancel-ready with a square hit area, tooltip, accessible label and immediate feedback; other seats are read-only. A creator's existing ready state should be respected rather than requiring another confirmation. Offer start, funding, or next round only when the snapshot exposes that operation. A pending button should preserve its footprint so labels do not move the layout.

The waiting observation is not a live rule state. Do not fabricate hole cards, initial bets, a turn, or pieces before the server starts a match. For poker, opponents and spectators only see the public projection; never hide secret cards with CSS after receiving them unnecessarily.

## Controls and feedback

Use primary text buttons for meaningful decisions and compact icons with labels/tooltips for secondary controls. Keep readiness and gameplay actions close to the player's seat or established action area. Synchronization, exit, and details belong in the Host header; do not repeat them as another game toolbar.

Use current-seat emphasis and enabled action controls to communicate whose turn it is. Avoid adding both a large 'your turn' heading and a second status strip. Distinguish loading, disconnected, empty and unavailable states. Never tell the user to change filters when the source itself is disconnected.

An ordinary ready click needs no second confirmation. Errors should be small, clear and recoverable. A genuine asset commitment uses the existing Host flow instead of a game-created replacement dialog.

## Review the experience

Walk through waiting, ready, cancel-ready, start, play and next round. Include a bot-supported short match where available, a spectator view, and a temporarily unavailable connection. Verify keyboard operation and both theme modes. Check the actual rendered foreground and background together: theme toggling alone does not prove readable contrast. Use the real native Host for final SDK and header integration claims.
