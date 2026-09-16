# Game artwork and detail presentation

Apply this checklist when adding a game or changing its room artwork. It covers
the trusted Game Room client's list cards and metadata details, separately from
the game's isolated HTML board/table. Read it together with the SDK and
interaction guidance before marking visual work complete.

## Contract and ownership

The current GamePackage manifest has no list-cover or detail-artwork field.
HTML bundle assets belong to the isolated game's UI; they are not automatically
available to the trusted client's metadata panels. The current built-in room
artwork is bundled in the client and selected by its maintained components.
Adding an author-supplied metadata image requires a documented package/discovery
contract and trusted validation; do not invent a manifest property, fetch an
arbitrary remote image, inspect parent DOM or claim that uploaded games already
provide this capability. Games without bundled artwork must retain a complete,
readable generic detail surface.

## Artwork checklist

- Keep independent list-card and detail assets. Their crop, composition and
  text placement differ. A detail iteration must not overwrite an accepted
  list image or change its import.
- Place the detail's game objects mainly toward the upper right. Reserve
  quiet material and negative space on the left for the actual title and
  retain texture at the lower left rather than baking in a flat UI panel.
- Select material from the game's semantics: Gomoku may use a natural wooden
  board with stones; Texas Hold’em uses a green fabric/felt table with cards
  and chips. Reuse the composition and theme method, not a universal wood
  texture or gold palette. Preserve visible material texture and avoid
  unintended cyan/gray grading or saturated yellow surfaces.
- Images contain only artwork: no baked titles, tabs, buttons, avatars,
  counters or interface chrome. Render these through the actual components.
- Choose bounded resolution and compression for the actual hero size and
  display density. Inspect the shipped asset and real crop; a high-resolution
  master or an image-generation mockup is not acceptance evidence.

## Shared detail surface checklist

- Use the same dedicated detail artwork and palette in the selected lobby
  room's details, the in-room summary and the creation preview. Keep their
  shared RoomInfoHero and RoomInfoTabs composition consistent.
- Give the artwork enough height to show its focal objects without pushing
  tabs and the first content row out of a short window. Check top/right crop,
  long titles, narrow panels and short viewport heights; preserve usable
  scrolling. Do not change shared tab dimensions to compensate for an image.
- Check short content in a tall panel: content height is not surface height.
  Stretch the material surface through the full available panel height, while
  letting long content extend and scroll through one owning scroll container.
  Check the panel bottom in both application themes and small windows; do not
  use fixed heights or cover application chrome to hide an exposed background.
- Derive restrained light and dark palettes from the chosen material. A warm
  light image may use pale gold/cream with dark brown text; its dark counterpart
  needs a warm dark surface with ivory text and muted gold accents, rather than
  reusing a bright full panel. Scope palette variables to that game's detail
  surface so cards, other games and application chrome retain their themes.
  Green poker felt instead uses a restrained light sage surface with dark
  green text and a dark forest-green surface with warm ivory text. Derive
  each game's own palette; never apply another game's material colors simply
  because the panels share a component.
- Follow the actual public Host application theme projection and tokens. An
  explicit light preference must work while the OS is dark, and vice versa.
  Do not introduce independent plugin theme state or select the palette solely
  through system media queries. Inside the isolated game use the SDK theme,
  which is a separate boundary from the trusted metadata surface.
- Fade the photo's lower edge into the applicable surface variable. Keep the
  upper artwork clear; avoid a large gray fog or whitening the image too early.
  Review the title over its actual crop and gradient: pale material needs dark
  text or a restrained local treatment, while dark material needs light text.
- Review body text, inactive tab labels/icons, dividers, focus, hover and
  disabled states together. Only the selected tab has the persistent glass
  background; inactive tabs stay transparent, with readable interaction states.

## Native acceptance checklist

Use the existing authorized Native development session and source HMR when
available. Inspect actual light and dark application preferences, not just
system-theme emulation or a standalone fixture. Capture the selected lobby
detail and creation preview in both modes, and check the in-room shared summary
when a suitable room already exists. Do not create or alter a user's match
solely to obtain a screenshot; report unexercised states honestly.

Confirm readable title, facts and controls, natural photo-to-surface continuity,
visible tabs/first row, responsive crop and unchanged list artwork. Record the
relevant real screenshots and distinguish implementation, Native verification
and user acceptance. Run the owner's formatting and changed-style lint checks;
pure artwork/style feedback does not require new tests, SDK packaging or an
application restart. Report a Host-owned theme/chrome defect to its owner
instead of masking it with plugin CSS.
