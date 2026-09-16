---
name: game-development
description: Build or revise HTML games for the CordisX Game Room plugin, including game rules, iframe UI, preparation, configuration, and package validation. Use for authoring games that run inside Game Room, not for operating a player's live match.
---

# Game Room development

Build on the plugin's actual game SDK and package format. Start with [SDK index](references/sdk.md); use [interaction guidance](references/interaction.md) when designing a game screen. The bundled [Frame types](references/frame-sdk.d.ts) describe the supported API revision. Check the running Host and package before using additive capabilities; do not invent methods from examples or assume a browser preview implements the real bridge.

## Work in the game package

Keep authoritative rules and browser presentation separate. Rules implement setup, act, timeout, and per-seat observe in the game's rules source. The HTML iframe renders the supplied observation and requests operations through `GameUI`. It may use ordinary DOM or bundled React, but must not call Host internals, inspect parent DOM, read credentials, or treat another seat's hidden information as UI data.

In the Game Room source checkout, use `games/gomoku` and `games/holdem` as working examples, `games/ui/common.js` for the shared client lifecycle, `sdk/index.ts` for the package/rules types, and `games/tools/package.mjs` for reproducible assets. An installed skill is documentation, not a checkout: locate the requested game source first rather than assuming those paths exist beside this skill.

## Visual and interaction contract

- Keep html, body, and the game-stage background transparent. Host owns the page backdrop. A board, felt table, cards, or game-specific objects may have their own surfaces.
- Consume the SDK theme and adapt semantic text/border/control colors. Do not make a second fixed light/dark page. The current bridge provides a theme mode, not a full Host color-token object.
- Fit the actual frame viewport. Declare a realistic `minimumViewport` where needed; do not hard-code a 640px frame or assume the details panel is always an overlay.
- Render the waiting scene before setup: show the actual public seats and readiness without inventing cards, bets, moves, or initialized rule state.
- Put icon-only ready/cancel-ready buttons next to the player's own seat, with square hit areas and tooltips/accessible labels. Provide immediate local feedback, synchronize through the SDK, and reconcile or offer retry on failure. Do not add an extra confirmation for ordinary preparation.
- Let Host own navigation, synchronization, leave, and room-details controls. Avoid duplicate toolbars inside the game. Game lifecycle controls such as start/next round remain discoverable in the game when the snapshot offers them.
- Use semantic buttons, accessible labels, visible focus, and meaningful disabled/loading state. An Agent operates the same interface as a person; do not create a hidden alternate gameplay API for it.

## Deliver the requested game

Use the existing shared configuration schema path rather than hand-writing another configuration form. Preserve room/package identity across rebuilds: publish new immutable versions instead of editing an existing room's rules package. Validate resource hashes and exercise actual waiting, ready/cancel-ready, play, and next-round states. Check light/dark and wide/narrow views; verify a real Host for bridge claims. A screenshot or standalone mock is not evidence of multiplayer or SDK connectivity.

Keep scope lightweight for casual play. Reuse existing SDK synchronization and rules behavior; do not add permission dialogs, asset systems, or strict competitive features unless requested. Distinguish local preview publication from external distribution authorization.
