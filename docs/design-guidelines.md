# Design Guidelines

## Dashboard Direction

- Dashboard UI follows an artwork-first music-player model, not a desktop card dashboard.
- Visual reference is Apple Music mood and hierarchy: calm, clean, layered, and mobile-first.
- Keep the experience centered and self-contained on desktop. Do not expand into split admin panes unless a future requirement demands it.

## Visual System

- Fonts:
  - UI/body: `Be Vietnam Pro`
  - Track title/display: `Outfit`
- Avoid Inter, Roboto, Arial, and generic purple-blue startup gradients.
- Base palette stays dark and neutral.
- Ambient color comes from the current track artwork through same-origin artwork proxy sampling.
- Surfaces use restrained translucency and tinted shadows. Do not add neon glow or loud glass effects.

## Layout Rules

- Primary dashboard shell is a single centered player container with:
  - top status row
  - full-screen tab views
  - pinned bottom navigation
- Tabs are:
  - `Queue`
  - `Now Playing`
  - `Settings`
- `Now Playing` stays the default and center nav action.
- Keep safe-area padding for the bottom tab bar and compact mobile widths.

## Player View

- Order:
  - 1:1 artwork
  - title
  - secondary artist/status copy
  - volume row
  - progress row
  - bottom nav
- Track title stays one line.
- Only enable marquee when measured overflow exists.
- Idle and stopped states must keep the same layout shape; only copy and status styling change.

## Queue View

- Queue is read-only.
- Show simple ordered items with title and artist.
- Empty and stopped states must use direct, plain copy.

## Settings View

- Settings order is:
  - `Dashboard`
  - `Your taste`
  - `Advanced`
- Keep the dashboard block minimal:
  - top header should use the same small uppercase label treatment as `Playing` in `Queue`
  - top header should only say `Dashboard`
  - one full-width curved `Last 7 days` line chart at the top
  - chart container should be frameless: no card background, no border
  - chart color should stay static white; do not bind it to artwork-driven accent colors
  - asymmetric grid underneath
  - `Plays` and `Tracks` should render as plain metrics, not boxed cards
  - `Plays`, `Tracks`, `Most artists`, and `Most tags` should all be scoped to the same trailing 7-day window as the chart
  - `Most artists` and `Most tags` should also be frameless
  - `Most artists` pinned on the right across both rows, without meter bars
  - `Most tags` spanning the lower left area as plain inline text chips: no fill, no border, no counts, wrap to fill 2 rows
  - `Most tags` heading should match `Most artists`, while tag values stay bright white
  - `Most artists` stays capped at 3 items; `Most tags` should use enough items to naturally fill the 2-row area
- Below the analytics block, add a separate `Preferences` section label using the same small uppercase queue-style heading treatment, with a clearer vertical break from the dashboard block above.
- The lower `Settings` content should also feel frameless; avoid wrapping `Taste` or `Advanced` in heavy card chrome.
- Use `Advanced Settings` as the lower maintenance section title.
- The `Taste` textarea should also stay plain: no background, no border, no manual resize handle, and its height should auto-grow with content instead of staying fixed at a multi-row default.
- The `Taste` save action should be a small centered circular outline button with a gray checkmark icon, not a filled CTA pill; center the status message below it.
- Keep persona taste editing on the main settings surface below analytics.
- Keep destructive controls under `Advanced`.
- Style the four destructive / maintenance actions as a restrained 2-column border-only button grid with no fill and no hover treatment; keep `Clear cache` and `Clear history` on the same neutral treatment, with `Clear cache` appearing first, while the harder actions stay red-tinted through border/text only.
- The `Last 7 days` chart should expose point values through a minimal tooltip: desktop uses hover/focus, mobile uses tap, and the tooltip itself should render as white numeric text only, with no filled bubble background.
- Keep the dashboard grid composition stable on mobile too; do not collapse the stats/artists/tags layout into a single-column fallback unless a later design change explicitly requires it.
- Preserve explicit confirmation for cleanup and daemon stop actions.
- Do not add extra admin controls unless they already exist in runtime behavior.

## Motion and Interaction

- Only animate `transform`, `opacity`, and necessary background transitions.
- Keep transitions in the 180-420ms range.
- Respect `prefers-reduced-motion`; marquee and palette transitions should calm down or stop.
- Keep keyboard focus visible on nav, buttons, summary toggles, and textarea.

## Implementation Notes

- Use `/api/artwork?src=...` for dashboard artwork display and palette extraction.
- Do not sample remote artwork URLs directly in canvas.
- Keep front-end modules small and focused; avoid large single-file dashboard scripts.
