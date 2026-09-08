# Client implementation and verification

Audience: plugin maintainers. This guide indexes the client-owned implementation;
[server API](server-api.md) owns wire semantics and [architecture](architecture.md)
owns product invariants. This is an implementation checkpoint, not user acceptance.

## Package and preview

`client/` is an independent npm package/lock generated from maintained Host creator
`b75fa2c6f9563924feca271242e2709c136033a3`. `cordisx/vite` produces the indexed
`dist/runtime/artifact.json`, entry, lazy page chunk and CSS. Initial registration
has no imported page stylesheet. React comes only from `cordisx/react`.

`client/cordisx.config.json` is an explicitly labelled **sample-data** Playground
composition. `sample:false` selects live discovery. Sources are separate origin,
server identity and account tuples. Sample state never falls back into live state.

Host owns the Header, three top-level route tabs (Lobby, My Agents, Dispatch),
controls, outer padding and Manager scrolling. Client owns the compact two-column
room results and right-hand Agent list. Personal history and balances are child
pages; sources belong to settings. There is no global current-server selector.

Playground at `http://127.0.0.1:43129/` is an independent local review service. It
uses its own external home and the actual plugin bundle. Open Manager → Lobby if
the sidebar entry does not open Manager. The three UI extension points require
Host authorization; Playground review navigation currently auto-allows only the
sidebar and body seat, so authorize the Manager navigation entry in its UI.
This is not a native `app://` verification or an accepted UI.

## Boundaries and failure behavior

- `data/port.ts` is an internal view-model port, not a second server contract.
- `data/live.ts` decodes server HTTP v1; `data/http.ts` owns its injectable transport.
  The baseline public-discovery transport rejects authenticated operations.
  Host secure HTTP/credential connection integration is in progress.
- `data/aggregate.ts` independently publishes each source, bounds timeouts, aborts
  replacement requests and fences stale/disposed completions. Offline rooms are
  excluded from actionable results. Incompatible handshake state stays visible.
- Invitations encode exact source origin, serverId and roomId. Decoding rejects
  unknown or mismatched origins; joining rechecks server identity.
- Token consent is version/rules/stake/policy specific. Economic instances remain
  separate; there is no summed cross-instance balance. Unreviewed packages are
  disclosed and are not categorically disallowed for Token.
- Uploaded UI must use Host restricted content service. No uploaded HTML/script is
  imported in the trusted renderer, and no private iframe/bridge is implemented.
- The product does not yet claim live Agent execution, wallet funding, native
  lifecycle or installed-generation validation. These consume the respective
  public Host and owning service adapters when ready.

## CSS ownership

`app.tsx` lazily imports `styles/foundation.css`; `components/lobby.tsx` imports
`styles/lobby.css`. Both style plugin-owned `gr-*` DOM only. Foundation defines
semantic `--gr-*` tokens backed by public `--cx-*` values; lobby owns grid, card,
filter and Agent-list states. The lobby changes to one main column below 1120px,
room cards to one column below 720px. Host controls receive no selector overrides.
All styles are under 800 lines. dprint/Malva format, Stylelint checks maintained
CSS, shared ESLint policy enforces standard source max-lines.

## Evidence

Run `npm run check` and `npm run dev:dry-run` inside `client/`. Behavior tests cover
incremental multi-source results, timeout independence, refresh/dispose fences,
search/filter composition and origin-bound invitations. Actual browser review
confirmed two-column cards, right Agent panel and Host-owned tabs on the sample
composition in light theme. Dark/responsive, full interaction, live services and
native/installed lifecycle verification remain separate delivery work.
