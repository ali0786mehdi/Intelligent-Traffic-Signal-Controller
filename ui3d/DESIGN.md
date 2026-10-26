---
name: Intelligent Traffic Signal Controller · 3D
description: A daytime 3D intersection where a Dueling Double DQN, a fixed-time plan, and a gap-actuated controller run the same traffic side by side.
colors:
  asphalt: "#2b2e31"
  asphalt-2: "#363a3e"
  asphalt-3: "#43484d"
  paint: "#f5f3ec"
  paint-2: "#c9c6bd"
  paint-3: "#9d9b94"
  rule: "rgba(245, 243, 236, 0.28)"
  marking: "#efbf32"
  sign: "#0d6a49"
  sign-edge: "#f5f3ec"
  signal-green: "#2bd47f"
  signal-yellow: "#ffb300"
  signal-red: "#ff5a47"
  controller-static: "#ff8a6b"
  controller-actuated: "#efbf32"
  controller-dqn: "#45d8c4"
typography:
  display:
    fontFamily: "'Overpass', system-ui, sans-serif"
    fontSize: "1.32rem"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "'Overpass', system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 800
    lineHeight: 1.3
  title:
    fontFamily: "'Overpass', system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 800
    letterSpacing: "0.07em"
  body:
    fontFamily: "'Overpass', system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "'Overpass Mono', ui-monospace, monospace"
    fontSize: "0.72rem"
    fontWeight: 400
  caption:
    fontFamily: "'Overpass', system-ui, sans-serif"
    fontSize: "0.74rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  xs: "3px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  pill: "50%"
spacing:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "18px"
components:
  btn:
    backgroundColor: "{colors.asphalt-2}"
    textColor: "{colors.paint}"
    rounded: "{rounded.md}"
    padding: "7px 13px 6px"
    height: "36px"
  btn-hover:
    backgroundColor: "{colors.asphalt-3}"
    textColor: "{colors.paint}"
    rounded: "{rounded.md}"
  btn-active:
    backgroundColor: "{colors.paint}"
    textColor: "{colors.asphalt}"
    rounded: "{rounded.md}"
  play-btn:
    backgroundColor: "{colors.paint}"
    textColor: "{colors.asphalt}"
    rounded: "{rounded.pill}"
    width: "44px"
    height: "44px"
  play-btn-hover:
    backgroundColor: "#ffffff"
    textColor: "{colors.asphalt}"
    rounded: "{rounded.pill}"
  seg-button:
    backgroundColor: "transparent"
    textColor: "{colors.paint-2}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "6px 8px 5px"
  seg-button-active:
    backgroundColor: "{colors.paint}"
    textColor: "{colors.asphalt}"
    rounded: "{rounded.sm}"
  icon-btn:
    backgroundColor: "transparent"
    textColor: "{colors.paint-2}"
    rounded: "{rounded.md}"
    width: "36px"
    height: "36px"
  slab:
    backgroundColor: "{colors.asphalt}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  sign-header:
    backgroundColor: "{colors.sign}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "14px 18px 15px"
---

# Design System: Intelligent Traffic Signal Controller · 3D

## Overview

**Creative North Star: "The Road-Marking Interface"**

Every panel, label, and control is built from the vocabulary of a real intersection: asphalt slabs with aggregate grain texture, dashed thermoplastic lane-line dividers between sections, white thermoplastic for selected states, and marking yellow for focus rings and live accents. The three controllers are colour-coded like signal lampheads—coral static, amber actuated, cyan D3QN—and the city beyond the canvas (warm plaster, sage lawn, park pavilion) provides depth without competing for attention.

The layout refuses the dashboard-beside-a-canvas arrangement: the 3D junction fills the full viewport and UI panels float in front of it, painted in the same surface language as the road. Density is high but deliberate—every value shown corresponds to a live simulation value—and whitespace is replaced by the breathing room of the grain texture and the open sky behind.

Typography is entirely Overpass (Highway Gothic lineage) paired with Overpass Mono for measurements and tabular data. The pairing is utilitarian and purposeful: a public-infrastructure display face for an infrastructure control system.

**Key Characteristics:**
- Full-bleed WebGL canvas behind all panels; no chrome surrounds the intersection.
- UI panels are asphalt-surfaced slabs with a subtle SVG fractal-noise grain, never flat solid fills alone.
- Dashed lane-line dividers (`repeating-linear-gradient`) replace rule lines as section separators.
- Marking yellow (`#efbf32`) is the single focus-ring and live-accent colour; it earns its rarity.
- Three controller identity colours (coral/amber/cyan) used only for data traces, key swatches, and winning-cell callouts—never as panel fill.
- Overpass 800 weight for all labels and headings; Overpass Mono for every numeric readout.

## Colors

The palette is an asphalt night pulled into daytime—three neutral surface steps plus warm off-white thermoplastic, with signal colours and controller identities as the only chromatic voices.

### Primary
- **Asphalt** (`#2b2e31`): The base surface colour for all UI slabs, the transport bar, and the cabinet. Used with the `--grain` SVG texture overlay.
- **Asphalt Mid** (`#363a3e`): Raised interactive surface—default `btn` background, segmented control track. Signals a tappable surface above the base panel.
- **Asphalt High** (`#43484d`): Hover state for the above. The third step completes the tonal lift sequence without introducing a new hue.

### Secondary
- **Marking Yellow** (`#efbf32`): The single live accent. Used for: focus-visible outline, timeline surge marker, queue pillar material in the 3D overlay, actuated controller identity, and `policy-note` callout backgrounds (at 10% opacity). Its rarity makes it the eye's landing point.

### Tertiary
- **Guide Sign Green** (`#0d6a49`): The project title header mimics a US highway guide sign. Used only on that one element. Not available as a general accent.
- **Controller DQN Cyan** (`#45d8c4`): D3QN identity colour; used on data traces, the winning cell in the results table, and the best Q-value bar.
- **Controller Static Coral** (`#ff8a6b`): Fixed-time controller identity. Data trace and key swatch only.
- **Signal Green / Yellow / Red** (`#2bd47f` / `#ffb300` / `#ff5a47`): Signal-phase specific. Used in phase badge backgrounds and the state-vector strip heat encoding for phase slots.

### Neutral
- **Paint** (`#f5f3ec`): Primary text and icon colour on all dark surfaces. Also the fill for the play button (inverted) and selected segmented-control buttons.
- **Paint-2** (`#c9c6bd`): Secondary text (9.6:1 on asphalt). Detail lines, scenario blurbs, phase-meta readouts. Annotated contrast ratio in the source.
- **Paint-3** (`#9d9b94`): Tertiary text (5.6:1 on asphalt). Captions, fine print, chart axis labels, hints. Annotated contrast ratio in the source.
- **Rule** (`rgba(245, 243, 236, 0.28)`): The translucent divider colour used in the dashed lane-rule separators and the vertical vsep in the transport bar.
- **Scene Fog** (`#dfe9ee`): The page/body background and Three.js fog colour. Creates seamless horizon blending between the 3D world and the browser chrome.

### Named Rules
**The One-Accent Rule.** Marking yellow (`#efbf32`) is the sole global accent. It appears on focus rings, the timeline surge marker, and the overlay queue pillars. No other colour may serve as a general interactive accent; controller identity colours (coral, amber, cyan) are data channels, not UI chrome.

**The Road-Surface Rule.** UI slabs always carry both `background-color: var(--asphalt)` and `background-image: var(--grain)`. A plain `#2b2e31` fill without the grain texture is a defect, not a variant.

## Typography

**Display Font:** Overpass (Highway Gothic lineage), weights 400 / 600 / 800, latin subset via `@fontsource/overpass`.
**Mono Font:** Overpass Mono, weights 400 / 600, via `@fontsource/overpass-mono`.
No secondary display face is loaded; Overpass covers every text role.

**Character:** A single-family system built from a public-infrastructure face. The 800-weight labels read like road signs at a glance; the mono numerals hold alignment in live-updating tables without visual jitter.

### Hierarchy
- **Display** (800, 1.32rem, 1.12, −0.005em letter-spacing): Project title in the guide-sign header. Appears once per viewport.
- **Headline** (800, 0.95rem, 1.3): Racer name in the controller row—the most prominent interactive label in the race panel.
- **Title** (800, 0.8rem, uppercase, 0.07em letter-spacing): Section headings inside slabs (`h2`, `h3`). All-caps with wide tracking mimics panel labelling on real signal cabinets.
- **Body** (400, 0.82rem, 1.45): Detail lines, scenario blurbs, board text, toast notifications.
- **Label** (Overpass Mono 400–600, 0.72–0.86rem, tabular-nums): Every live numeric readout—clock, phase timer, Q-values, average wait, veh/h counts. `font-variant-numeric: tabular-nums` is always set.
- **Caption** (400, 0.74rem, 1.45, `--paint-3`): Fine print, hints, chart captions, `aria-label`-adjacent visible cues.

### Named Rules
**The No-Serif Rule.** No serif face is loaded or used. Overpass is the sole type family for all rendered text, including in-canvas canvas-texture labels (queue pillar sprites use `'Overpass Mono', monospace` in the canvas 2D context).

**The Mono-for-Numbers Rule.** Every live numeric value uses `'Overpass Mono'` with `font-variant-numeric: tabular-nums`. Mixing proportional digits into live-updating readouts is a defect.

## Layout

The app shell is a `position: fixed; inset: 0` CSS grid with three columns (`minmax(300px, 360px)` left panel column, `1fr` canvas column, `minmax(300px, 344px)` right panel column) and four rows (`auto auto 1fr auto`). The WebGL canvas sits at `z-index: 0` behind all panels (`z-index: 1`). Panels use `pointer-events: none` on the grid container and `pointer-events: auto` on each child, so the canvas receives mouse/touch events through any uncovered area.

The outer padding is `max(18px, env(safe-area-inset-*))` on all sides, honouring notched phones in landscape. Panel gap is `12px` throughout. The transport bar is centred across all three columns (`grid-column: 1 / 4; justify-self: center`).

**Mid breakpoint (≤ 1180px):** Columns tighten to `minmax(280px, 330px) 1fr minmax(280px, 320px)`. The compass rose and vsep separator are hidden.

**Phone breakpoint (≤ 900px):** The three-column grid collapses to a single-column flex column. The canvas becomes `position: sticky; top: 0; height: 52svh` with `border-radius: 0 0 16px 16px`. The transport bar becomes `position: fixed; bottom: max(8px, env(safe-area-inset-bottom))` in a two-row grid with named areas (`play clock restart board` / `speed speed view view`). All panels stack vertically with natural scroll; `body { overflow: auto }` is restored at this breakpoint.

**Narrow phone (≤ 420px):** Speed segment button inline padding reduces to `7px`.

**Reduced-motion:** All `transition-duration` and `animation-duration` are forced to `0.01ms` and `animation-iteration-count` to `1` via a `prefers-reduced-motion: reduce` block.

The spacing rhythm uses a consistent `6px` / `10px` / `12px` / `14px` / `16px` / `18px` step sequence extracted from the slab internals (gap between rows: `6px`; slab inner gap: `10px`; slab padding: `14px 16px`; outer padding: `18px`).

## Elevation & Depth

This system uses a single compound shadow token as its only elevation expression. Surfaces are flat at rest; the shadow appears on every floating slab, the guide sign, and the toast—not as a hover state, but as a structural declaration that the panel floats above the canvas.

### Shadow Vocabulary
- **Slab shadow** (`0 14px 34px -14px rgba(28, 38, 48, 0.55), 0 3px 8px -2px rgba(28, 38, 48, 0.28)`): Applied via `--shadow` custom property to every `.slab`, the `.sign`, and the `.toast`. The two-layer compound gives a deep ambient spread plus a tight proximity shadow.
- **Sign inset border** (`inset 0 0 0 3px var(--sign), inset 0 0 0 5px var(--sign-edge)`): The guide-sign header uses inset box-shadows to draw its double border (green inner, off-white outer), reproducing the retroreflective sheeting edge of a real highway sign. This is a component-local decoration, not a system elevation token.

### Named Rules
**The Structural Shadow Rule.** Shadows do not respond to hover or state changes. Every `.slab` and the `.sign` carry `var(--shadow)` unconditionally. Motion and state changes are expressed through background-color and color transitions, not shadow changes.

## Shapes

The form language is rounded-rectangular throughout, with a single consistent radius token (`--radius: 10px`) for slabs and a tighter family for interactive controls. Circles appear only for the play button (50% radius) and the compass; no other freeform shapes are used.

- **Slabs** (`border-radius: 10px` via `--radius`): All `.slab` panels, the `.sign` header (12px on desktop, 10px on mobile).
- **Buttons / Segmented controls** (`border-radius: 8px`): `.btn`, `.icon-btn`, segment track (8px), segment buttons (6px inside the 8px track—one step tighter to inset cleanly).
- **Play button** (`border-radius: 50%`): The sole circle in the UI; its pill form distinguishes the primary transport action from all other controls.
- **Phase badges** (`border-radius: 5px`): The signal-phase indicators use a 5px radius, slightly tighter than controls, reading as data chips.
- **Racer rows** (`border-radius: 8px`): Controller selection rows; same radius as buttons.
- **Lane-rule divider**: Not a shape but a texture—`repeating-linear-gradient(90deg, var(--rule) 0 16px, transparent 16px 26px)` at 2px height. The dashed pattern reads as a painted lane line, not a hairline rule.
- **State-vector cells** (`border-radius: 2px`): Heat-strip cells are nearly square micro-chips.

### Named Rules
**The No-Hard-Edge Rule.** Every interactive surface carries at minimum a 6px radius. Zero-radius rectangles do not appear in the UI layer (they appear in the 3D scene as road geometry, not as panels).

## Components

### Buttons

The system has three button archetypes: the surface button (`.btn`), the icon button (`.icon-btn`), and the play/pause button (`.play`).

**`.btn` — surface button**
- Shape: gently rounded (8px radius).
- Default: `#363a3e` background, `#f5f3ec` text, 1px border `rgba(245,243,236,0.16)`.
- Hover: `#43484d` background, border lightens to `rgba(245,243,236,0.32)`.
- Active / aria-pressed / aria-expanded: inverts to `#f5f3ec` background, `#2b2e31` text—the thermoplastic-white selected state.
- `.btn.wide`: full-width, `margin-top: 12px`.
- Icons inside: 18×18px SVG strokes (`stroke-width: 2`, `stroke-linecap: round`, `stroke-linejoin: round`).

**`.icon-btn` — icon-only button**
- Shape: 36×36px, 8px radius.
- Default: transparent background, `--paint-2` icon colour.
- Hover: `rgba(255,255,255,0.08)` background, `--paint` icon colour.
- No border.

**`.play` — primary transport control**
- Shape: 44×44px circle (50% radius).
- Default: `--paint` background, `--asphalt` icon colour.
- Hover: white background, `transform: scale(1.04)`.
- The icon switches between pause and play SVG paths via CSS display toggling on `.app.paused`.

### Segmented Controls

`.seg` is the system's radio-group pattern. A `rgba(0,0,0,0.22)` dark track with 3px padding, 8px radius. Buttons inside: 6px radius, min 34px height, transparent default, `--paint-2` text. Selected (`aria-checked="true"`): `--paint` background, `--asphalt` text—the inverted thermoplastic state. `.seg.small` reduces height to 30px and font to 0.76rem.

### Slabs (Panels / Containers)

The `.slab` is the primary container primitive.
- Background: `var(--asphalt)` colour + `var(--grain)` SVG fractal-noise texture overlay (always both).
- Corner: 10px radius.
- Shadow: `var(--shadow)`.
- Padding: `14px 16px`.
- Section divider: `.lane-rule`—a 2px dashed gradient at `14px 0 12px` margin, mimicking a painted lane line.
- Slab headings (`h2`, `h3`): 0.8rem / 0.74rem, weight 800, uppercase, 0.07em tracking.

### Racer Rows (Controller Selector)

`.racer` is a three-column grid button (12px colour key / label+sub / value) with a `1px transparent` border at rest and `rgba(245,243,236,0.55)` border + `rgba(245,243,236,0.1)` background when selected. A "In view" tag chip (`--paint` background, `--asphalt` text, 4px radius) animates in on selection with `opacity` + `translateX` transition at `0.3s var(--ease)`.

### Phase Badges

`.phases li`: 34px height, 5px radius, `rgba(255,255,255,0.05)` default. Active green: `#2bd47f` fill, dark text. Active yellow: `#ffb300` fill, dark text. Active red: `#ff5a47` fill, dark text. An `<i>` element inside grows `width` from 0 to 100% to show elapsed fraction.

### Transport Bar

A flex row (`gap: 10px`) constrained to the viewport width, centred. Components in order: `.play` circle button, clock+timeline, speed segmented control, restart icon button, vsep (1px × 26px rule-coloured divider), view segmented control, compass rose, SUMO results button. On mobile the bar becomes a fixed two-row grid (see Layout).

### Timeline

A `clamp(110px, 16vw, 230px)` track (6px height, 3px radius, `rgba(255,255,255,0.1)` background). Progress fill: `--paint`. Surge marker: a 2px absolute `--marking` bar with a pulse animation (`box-shadow` at 4px spread, `rgba(239,191,50,0.35)`) when `.app.surging`.

### Toast

Fixed, centred above the transport bar (`bottom: 92px`). `--paint` background, `--asphalt` text. Appears via `opacity` + `translateY(-8px → 0)` at `0.3s var(--ease)`. Auto-dismisses after 3.8 s.

### State-Vector Strip

`.statevec` contains labelled groups of heat-strip cells (`.sv-cells i`): 12px tall, 2px radius, near-transparent default (`rgba(255,255,255,0.06)`), tinted at run-time with controller-specific RGB channels (density/speed: cyan `69,216,196`; queue: amber `239,191,50`; wait: coral `255,138,107`; phase/min-green: paint `245,243,236`).

## Do's and Don'ts

### Do:
- **Do** use both `background-color: var(--asphalt)` and `background-image: var(--grain)` together on every `.slab`. The grain is structural to the road-marking world.
- **Do** use `font-family: 'Overpass Mono'` with `font-variant-numeric: tabular-nums` for every numeric readout that updates live.
- **Do** use `outline: 2px solid var(--marking); outline-offset: 2px` for all `:focus-visible` states. Marking yellow is the only focus colour.
- **Do** use the dashed `.lane-rule` gradient as the section divider inside slabs. A hairline `border-top` is not part of this world.
- **Do** use `var(--ease)` (`cubic-bezier(0.16, 1, 0.3, 1)`) for all state transitions. Do not introduce additional easing curves.
- **Do** keep controller identity colours (coral `#ff8a6b`, amber `#efbf32`, cyan `#45d8c4`) confined to data channels: traces, key swatches, winning cells, bar fills. Do not use them as panel fills or text colours in the UI chrome.
- **Do** honour `prefers-reduced-motion: reduce` by targeting all `transition-duration` and `animation-duration` to `0.01ms`.

### Don't:
- **Don't** add a serif or display face. Overpass is the only typeface. New screens must not import additional font families.
- **Don't** use `box-shadow` changes as hover or state feedback—shadows are structural and static per the Structural Shadow Rule.
- **Don't** use solid fills without the `var(--grain)` texture on slab-level containers. A plain `background: #2b2e31` on a slab is a craft defect.
- **Don't** use the guide-sign green (`#0d6a49`) outside the `.sign` header. It is a literal reproduction of a highway sign, not a brand accent.
- **Don't** introduce zero-radius rectangles in the UI layer. Every interactive or container surface has at minimum a 6px corner radius.
- **Don't** place controller identity colours on backgrounds where they would compete with the thermoplastic-white selected state; the white inversion is the selection signal.
- **Don't** display raw CSS pixel measurements in UI copy. Values are for code only; visible labels use semantic language ("s", "veh/h", etc.).

---

*Not canonized: The `theme-color` meta tag value (`#2b2e31`) exactly matches `--asphalt`—it is a browser-chrome detail, not a design token. The `background: #dfe9ee` on `html, body` is the scene-fog colour used to blend the Three.js horizon; it is not a UI surface colour and should not be used for panels. The 3D scene colour palette (`C` object in scene.js: plaster colours, canopy greens, car tints, sky gradient values) are world-building constants for the WebGL scene and are not part of the 2D design system—they are not canonized here as UI tokens.*
