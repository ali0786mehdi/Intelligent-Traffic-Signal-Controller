---
name: ui3d
description: Charcoal glass instrument panels over a stylized, sunlit New York intersection.
colors:
  panel: "rgba(17,18,20,0.86)"
  panel-solid: "#111214"
  ink-0: "#0a0b0c"
  ink-1: "#0b0c0d"
  ink-2: "#1a1c1f"
  ink-3: "#2a2c2f"
  ink-4: "#2a2c30"
  ink-5: "#34363a"
  text: "#f3f3f1"
  text-2: "#b6b9be"
  text-3: "#8b8f96"
  page: "#c9d6e1"
  white: "#fff"
  raise: "rgba(255, 255, 255, 0.045)"
  raise-2: "rgba(255, 255, 255, 0.08)"
  line: "rgba(255, 255, 255, 0.075)"
  line-2: "rgba(255, 255, 255, 0.14)"
  veil-1: "rgba(255, 255, 255, 0.06)"
  veil-2: "rgba(255, 255, 255, 0.07)"
  veil-3: "rgba(255, 255, 255, 0.1)"
  veil-4: "rgba(255, 255, 255, 0.2)"
  veil-5: "rgba(255, 255, 255, 0.6)"
  well: "rgba(0, 0, 0, 0.3)"
  well-2: "rgba(0, 0, 0, 0.35)"
  marking: "#f4c15d"
  signal-green: "#2fe08a"
  signal-yellow: "#ffb21a"
  signal-red: "#ff5547"
  controller-static: "#ff8f70"
  controller-actuated: "#f4c15d"
  controller-dqn: "#5ce1cf"
typography:
  sans: "Geist Sans, system-ui, sans-serif"
  mono: "Geist Mono, ui-monospace, monospace"
  sizes: ["10.5px", "11px", "11.5px", "12px", "12.5px", "13px", "13.5px", "14px", "15px", "18px", "22px", "26px"]
  weights: [500, 600]
rounded:
  hairline: "1px"
  tick: "2px"
  tick-2: "2.5px"
  bar: "3px"
  kbd: "5px"
  chip: "8px"
  control: "10px"
  control-2: "11px"
  segment: "12px"
  card: "16px"
  pill: "18px"
  round: "999px"
---

# ui3d design system

## Overview

The app is a live 3D intersection with instrument panels floating over it. The scene does
the visual work and the panels stay quiet: dark, translucent and readable over any
background. There are two layers, and each has its own rules.

1. **Panels.** Charcoal glass, Geist Sans for text, Geist Mono for every number.
2. **Scene.** A stylized, toon-shaded New York block at mid-morning. It is flat-lit, with
   no bloom, no reflections and no metallic gloss.

## Panels

- Surface: `--panel` (`rgba(17,18,20,0.86)`) with a 22px backdrop blur. 1px `--line` borders
  and a 16px radius. The shadow is soft and deep, plus a 1px inner top highlight.
- Text: `--text` for values and titles; `--text-2` (9.4:1) for body; `--text-3` (5.6:1) for
  labels. Nothing smaller than 10.5px.
- Numbers: Geist Mono with tabular figures, so countdowns and waits don't jitter.
- Colour carries meaning only:
  - Signal states use `--g` / `--y` / `--r`.
  - Controllers use static coral `#ff8f70`, actuated amber `#f4c15d`, and D3QN teal `#5ce1cf`.
  - The same three controller colours are used in the racer dots, the chart lines and the
    in-scene overlay.
- Motion uses one easing, `--ease` = `cubic-bezier(0.16,1,0.3,1)`:
  - Segmented controls slide a `.thumb`.
  - Q bars animate `transform: scaleX`.
  - The intro staggers the panels in.
- Layout on desktop is a three-column grid: brand+scenario and the race on the left, the
  cabinet or results board on the right, transport bar centred at the bottom. Below 900px
  the panels stack under the canvas.

## Scene art direction

The reference is stylized browser-game work (Bruno Simon's portfolio). The palette is our
own, taken from New York itself.

| Element | Treatment |
|---|---|
| Light | Hemisphere `#cfe4f4` / `#e7d6b3` at 1.55, warm sun `#fff4e2` at 1.75. No tone mapping. Soft 4096 shadow map at 0.82 intensity. |
| Sky | Gradient shader: `#2f7fd6` zenith → `#79b9ec` → `#e6eef0` horizon, small sun disc. Distance fog `#dfe8ea`. Puffy toon clouds drift east. |
| Materials | `MeshToonMaterial` with a 4-step ramp (`src/stylize.js`). No PBR, no emissive glow. |
| Buildings | Procedural (`src/nyc.js`): faded red, dark and tan brick, grey brick, cream brick, limestone, brownstone, and glass curtain-wall office towers. The junction corners keep the original saturated red brick, except the north-east block, which has a darker faded brick corner on the south and a glass office of the same height on the north. Cornices, fire escapes, awnings, shopfronts, stoops, wooden water towers, art-deco setback towers, hazy blue skyline. |
| Street | Canvas-textured asphalt and concrete slabs. High-visibility ladder crosswalks, double yellow centre line, worn paint. Hydrants, cobra-head lamps and a subway entrance with green globes. Kerbs are kept clear of small props. |
| Park | Fresh-green swaying grass blades, rounded tree canopies with wind, a paved fountain plaza ringed by benches, fountain with animated jets, iron fence. No trees on the line of sight to the junction. |
| Vehicles | Kenney cars under toon shading, about a third of them yellow cabs. MTA-style buses, motorcycles with riders, and autos are built in code. Tinted glass with a painted sky streak, a faint warm rim on the body, rounded head and tail lamps, and soft contact-shadow blobs. Paint colours are unchanged. Brake and indicator lamps are unlit colour. |
| Signals | Black housings with yellow-edged backplates. Lenses fade between unlit and lit colours. Optional screen-sized badges (direction letter, R/Y/G dots, countdown) sit above each overhead head and draw over the scene, toggled with `L`. |
| Agent overlay | State cells painted on the lanes. Queue is a flat amber strip from the stop line back, one car length (7.5 m) per queued vehicle, under the cars. The count label stays above the stop line at a fixed 4 m. |

What to avoid in the scene: bloom, HDRI reflections, glossy or metal surfaces, purple
shadows, and over-bright exposure.
