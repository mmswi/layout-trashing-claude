# Layout Thrashing Lab

An interactive playground for **layout thrashing**, forced synchronous layout, and
rendering performance. Tick a checkbox to inject one specific anti-pattern into a
live animation loop and watch it crater the frame metrics in real time.

Built with **Next.js 16 (App Router) + Bun + Biome**, plain CSS Modules, no UI
framework. Everything runs client-side and is calibrated to your display's actual
refresh rate.

## Run it

```bash
bun install
bun run dev
```

Open http://localhost:3000. Tick **Forced reflow loop** and watch FPS drop; hit
**Run benchmark** to see the same work run 10–100× slower when reads and writes
are interleaved instead of batched.

Scripts:

```bash
bun run dev        # dev server
bun run build      # production build
bun run lint       # biome check (lint + format check)
bun run format     # biome check --write (autofix)
bun run typecheck  # tsc --noEmit
```

## The two problems it shows

**1. Forced synchronous layout ("layout thrashing").** The browser batches layout:
you change the DOM, it marks layout dirty, and recomputes once before the next
paint. But if your JS *reads* a geometry value (`offsetHeight`,
`getBoundingClientRect`, `getComputedStyle`) after a write, the browser must flush
layout synchronously, right then. In a loop that's N reflows instead of one. The
fix is always the same: **batch every read, then every write.**

**2. Expensive frames.** Where a CSS property enters the pipeline
(`JS → Style → Layout → Paint → Composite`) sets its cost. Animating `transform` /
`opacity` is compositor-only and cheap. Animating `top` / `left` / `width` /
`margin` re-runs **layout** every frame; big `box-shadow` / `filter: blur` re-runs
**paint** every frame.

## The technique catalog

Each checkbox is one real, isolated pattern (see `lib/techniques.ts`). The
sidebar shows two separate groups: **Jank toggles** (the anti-patterns) and
**Healthy controls** — fixes and counter-examples that do comparable work and
deliberately stay green:

| Toggle | Kind | Stage | What it does |
| --- | --- | --- | --- |
| Forced reflow loop | anti-pattern | Layout | Writes a style then reads `offsetHeight` per box, per frame |
| Batched writes, then reads | control | Layout | The forced-reflow loop's exact work, batched — N reflows become one, metrics stay green |
| One read-write pair, one box | control | Layout | The forbidden write→read once, on one box — a rounding error; scale is the whole difference |
| Animate top / left | anti-pattern | Layout | Moves boxes with layout props instead of `transform` |
| `transition: all` | anti-pattern | Layout | Opts every property into transitions, including `margin` |
| Janky scroll tracking (TOC-style) | anti-pattern | Layout | Highlights the "active" box by reading `getBoundingClientRect` for all boxes on every scroll event — then writes the highlight, so the next event's reads pay a forced reflow |
| IntersectionObserver tracking | control | Layout | The same moving highlight, but the browser reports zone crossings — no geometry reads at all |
| getComputedStyle in a loop | anti-pattern | Layout | The "innocent" call that forces layout just like `offsetHeight` |
| Paint bomb | anti-pattern | Paint | Heavy blur/shadow each frame — compositor-bound, so the main-thread meter can't see it (that's the lesson) |

The **box-count slider** (50–3000) scales DOM size so you can find where each
technique starts to hurt.

## Reading the metrics

- **FPS** — capped at your detected refresh rate; green near it, red well below.
- **Frame** / **Worst** — average and worst frame time in ms vs the frame budget.
- **Jank** — percent of recent frames over budget.
- **Long tasks** — main-thread blocks >50ms (Chromium only).
- **Sparkline** — recent frame times, colored by budget.

The baseline motion is a pure `transform` animation (compositor-only), so the main
thread sits idle and FPS reads healthy until a toggle adds work. That idle baseline
is the control the anti-patterns are measured against.

## A note on the anti-patterns

This project deliberately ships patterns that good code should never contain. They
live **only** in `lib/techniques.ts` as the subject under study, each labeled with
why it's slow and the fix. Everything else follows the project coding standards
(see `CLAUDE.md`). A code-review pass should leave the technique registry alone.

## Sources

- [Paul Irish — What forces layout / reflow](https://gist.github.com/paulirish/5d52fb081b3570c81e3a)
- [web.dev — Avoid large, complex layouts and layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)
- [web.dev — Rendering performance](https://web.dev/articles/rendering-performance)
