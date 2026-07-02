# How the Layout Thrashing Lab works: one loop that breaks the page and times the damage

The lab has a strange job.

It has to *cause* jank on purpose. It has to *measure* that jank honestly. And it has to do both from inside the same page — without the measuring becoming part of the damage.

[The companion post](./layout-thrashing.md) explains layout thrashing itself. This one explains the machine: how a checkbox becomes running sabotage, where the numbers come from, and how the instrument is kept out of its own reading.

Here is the whole flow. Everything below is a zoom-in on one of these arrows.

    You tick a checkbox
    ↓
    React state: a Set of technique ids
    ↓
    A reconciler diffs the Set against what's currently running
    ↓
    One requestAnimationFrame loop runs the enabled techniques, every frame
    ↓
    The same loop times the gap since the previous frame
    ↓
    Every 200ms, a snapshot of those timings is handed to React
    ↓
    The metrics panel renders FPS, frame time, jank %

One running example, carried all the way through: **1,000 boxes on screen (the default), and you tick "Forced reflow loop."**

## Where everything runs

There is no server in this story.

The project is a Next.js 16 App Router app, built with Bun, linted with Biome, styled with plain CSS Modules. No UI framework.

`app/page.tsx` is a server component, but it only renders static prose — the header, the primer, the legend.

The entire lab is one client island: `components/Lab.tsx`, the only file that says `"use client"`. It owns the state, the frame loop, and the meter.

That is not a style choice. The jank being measured only exists in *your* browser, on *your* main thread, at *your* refresh rate. There is nothing a server could measure.

    app/page.tsx          static shell (server component)
    components/Lab.tsx    state + frame loop + orchestration (client)
    lib/techniques.ts     the anti-pattern catalog (data)
    lib/metrics.ts        the frame meter (pure logic, no React)
    components/*.tsx      panels that render what Lab hands them

## A technique is an object, not a component

Every checkbox in the sidebar is one entry in an array in `lib/techniques.ts`:

```ts
interface TechniqueBase {
  id: TechniqueId;
  label: string;
  stage: PipelineStage;   // layout | paint | style | composite
  summary: string;
  onEnable?: (refs: LabRefs) => TechniqueTeardown;
  onFrame?: (refs: LabRefs, frame: FrameContext) => void;
}

// kind: "anti-pattern"     adds whySlow / theFix / badSnippet
// kind: "healthy-control"  adds whyCheap / theLesson / goodSnippet
export type Technique = AntiPatternTechnique | HealthyControlTechnique;
```

Everything the UI shows — the label, the color-coded stage tag, the explainer under the checkbox — lives in the same object as the code that does the damage.

Most entries are anti-patterns. Three are **healthy controls**: the batched fix, a single read-write pair, and an IntersectionObserver tracker. They run real per-frame work and stay green on purpose — they are the counter-examples the anti-patterns get compared against.

The sidebar keeps the two kinds physically apart. The registry exports two filters over the same array:

```ts
export const ANTI_PATTERN_TECHNIQUES = TECHNIQUES.filter(
  (technique) => technique.kind === TECHNIQUE_KIND.antiPattern,
);
export const HEALTHY_CONTROL_TECHNIQUES = TECHNIQUES.filter(
  (technique) => technique.kind === TECHNIQUE_KIND.healthyControl,
);
```

and the Lab renders them as two separate lists — "Jank toggles" holds only the thrashing methods; "Healthy controls" sits below, badged green. The UI narrows on `kind` to pick the headings: an anti-pattern explains *why it's slow* and *the fix*; a control explains *why it's cheap* and *the lesson*.

The checkbox list is just a `map` over this array. Adding a new anti-pattern means adding one object. No component changes.

The behavior half is two hooks:

- `onEnable` runs once, when you tick the box. It sets things up — adds a CSS class, binds a scroll listener — and returns a **teardown** function that undoes all of it.
- `onFrame` runs on every animation frame while the box stays ticked.

Our running example, "Forced reflow loop," is almost entirely `onFrame`:

```ts
onFrame: (refs, frame) => {
  const flickerWidthPx = isEvenFrame(frame.frameIndex) ? "0px" : "2px";
  for (const box of refs.getBoxes()) {
    box.style.borderTopWidth = flickerWidthPx;  // WRITE — invalidates layout
    refs.sinkLayoutRead(box.offsetHeight);       // READ — forced sync reflow
  }
},
```

One write, one read, per box, per frame. With 1,000 boxes, that is 1,000 forced reflows inside a single frame. That is the payload.

But notice two things it does *not* do. It does not hold a list of boxes. And it does not throw the `offsetHeight` value away. Both are deliberate, and both need a section.

## Why techniques get getters, not values

Here is the naive version of `onEnable`:

```ts
// bad: hand the technique the boxes at enable time
onEnable: (boxes: HTMLElement[]) => { ... }
```

This breaks quietly.

The lab has a slider that changes the box count from 50 to 3,000. When it moves, React rebuilds the grid — every box element is destroyed and replaced.

A technique that captured the old array is now poking 1,000 elements that are no longer in the document. No error. No effect. The checkbox is ticked and nothing happens.

So techniques never receive values. They receive **getters**:

```ts
export interface LabRefs {
  getBoxes: () => HTMLElement[];
  getScrollArea: () => HTMLElement | null;
  sinkLayoutRead: (value: number) => void;
}
```

`getBoxes()` reads from a ref the Lab keeps current. Whenever the box count commits, the Lab re-collects with `grid.querySelectorAll("[data-box]")` and swaps the ref's contents.

A technique enabled before the slider moved still sees the new boxes afterward, because it asks fresh every frame.

## How a checkbox becomes running code

The only React state involved in toggling is a Set:

```ts
const [enabledIds, setEnabledIds] = useState<ReadonlySet<TechniqueId>>(...);
```

Tick a box, the id goes in. Untick, it comes out.

An effect watches that Set and calls `syncTechniques` — a small reconciler. It diffs *what should be running* against *what is running*.

The trick is how "what is running" is tracked: a `Map<TechniqueId, () => void>` of teardown functions. The Map's keys *are* the running set. The Map's values are how to undo each one.

Here is the whole reconciler, from `Lab.tsx`:

```ts
const syncTechniques = useCallback(
  (enabled: ReadonlySet<TechniqueId>, rebuildAll: boolean) => {
    const teardowns = teardownsRef.current;

    // The boxes were just replaced: every running technique points at dead
    // elements. Tear everything down; the enable loop below re-applies.
    if (rebuildAll) {
      for (const teardown of teardowns.values()) teardown();
      teardowns.clear();
    }

    // Running, but no longer ticked → undo it, forget it.
    for (const [id, teardown] of teardowns) {
      const stillEnabled = enabled.has(id);
      if (!stillEnabled) {
        teardown();
        teardowns.delete(id);
      }
    }

    // Ticked, but not yet running → set it up, remember how to undo it.
    for (const technique of TECHNIQUES) {
      const shouldEnable = enabled.has(technique.id) && !teardowns.has(technique.id);
      if (shouldEnable) {
        const teardown = technique.onEnable?.(labRefs);
        teardowns.set(technique.id, teardown ?? noop);
      }
    }

    // Precompute the hot-path list so the frame loop never has to filter.
    activeFrameTechniquesRef.current = TECHNIQUES.filter(
      (technique) => enabled.has(technique.id) && Boolean(technique.onFrame),
    );
  },
  [labRefs],
);
```

Walk it once with the running example. You tick "Forced reflow loop":

- `rebuildAll` is false — the boxes didn't change. Skip.
- Nothing is running that shouldn't be. Skip.
- `forced-reflow-loop` is in the Set but not the Map — call its `onEnable(labRefs)`, store the teardown. (This technique's setup is trivial; its teardown resets every box's `borderTopWidth`.)
- Rebuild the active list: it now contains one technique.

You untick it: the second loop finds `forced-reflow-loop` in the Map but not the Set, runs the teardown — every box's border resets — and deletes the entry. The active list rebuilds to empty. The grid is exactly as it was before you ticked.

That last line of the reconciler matters more than it looks. The active array is precomputed *once per toggle* and stored in a ref. The frame loop never filters, never checks the Set, never reads React state — it walks a prebuilt array. The hot path does not touch React at all.

## The heartbeat: one requestAnimationFrame loop

There is exactly one loop, set up once in an effect, with a cleanup tight enough that React Strict Mode's dev double-mount can't leave a second one running.

Every frame, in this order:

    1. delta = thisTimestamp − lastTimestamp   →  meter.pushFrame(delta)
    2. run every active technique's onFrame
    3. every 30 frames: stamp the read sink into a DOM attribute
    4. if 200ms have passed: setMetrics(meter.snapshot())
    5. requestAnimationFrame(step)  — schedule the next beat

And here is that loop in full, from `Lab.tsx`:

```ts
const step = (timestampMs: number) => {
  if (!isLoopActive) return;

  // 1 — measure. timestampMs is handed in by the browser: the start time of
  // this frame. The difference from the previous one IS the frame time.
  const lastTimestamp = lastFrameTimeRef.current;
  if (lastTimestamp !== null) meter.pushFrame(timestampMs - lastTimestamp);
  lastFrameTimeRef.current = timestampMs;

  // 2 — sabotage. Run every enabled technique's per-frame payload.
  const frame: FrameContext = { frameIndex: frameIndexRef.current, timeMs: timestampMs };
  for (const technique of activeFrameTechniquesRef.current) {
    technique.onFrame?.(labRefs, frame);
  }
  frameIndexRef.current += 1;

  // 3 — keep the forced reads observable (every 30th frame).
  const shouldStampSink = frameIndexRef.current % SINK_STAMP_FRAMES === 0;
  if (shouldStampSink && gridRef.current) {
    gridRef.current.dataset.sink = String(layoutReadSink.current | 0);
  }

  // 4 — report, at 5Hz, never per frame.
  const shouldFlushMetrics = timestampMs - lastMetricsFlushRef.current >= METRICS_FLUSH_MS;
  if (shouldFlushMetrics) {
    setMetrics(meter.snapshot());
    lastMetricsFlushRef.current = timestampMs;
  }

  // 5 — schedule the next beat.
  rafIdRef.current = requestAnimationFrame(step);
};
```

Three details worth pausing on.

`frameIndex` is how techniques animate without owning a clock — the forced-reflow loop flickers its border on even vs odd frames, the `transition: all` toggle flips state every 22nd frame.

`layoutReadSink.current | 0` truncates the accumulated float to an integer before stamping it into the DOM — the value's only job is to be *observably used*, not readable.

And `isLoopActive` plus the `cancelAnimationFrame` in the effect's cleanup is what makes Strict Mode's double-mount safe: the first mount's loop is dead before the second one starts.

Now the part that makes the whole design work.

**The meter never does any work. It just reads the clock.**

The browser calls a `requestAnimationFrame` callback once per frame it actually renders. If the main thread spends 200ms inside step 2 — a thousand forced reflows, in our example — the browser cannot start the next frame until that finishes. So the next callback fires 200ms later.

The damage dilates the gap. The meter measures the gap.

    healthy frame:   |—8ms—|—8ms—|—8ms—|          deltas ≈ 8.3ms  → 120 FPS
    thrashing:       |———— 200ms ————|———— 200ms  deltas ≈ 200ms  → 5 FPS

Nothing instruments the techniques. Nothing wraps them in timers. Causing the jank and measuring the jank are the same loop noticing it is being called less often.

## The sink: reads that can't be thrown away

Back to that second oddity in the technique code: `refs.sinkLayoutRead(box.offsetHeight)`.

Here is the naive version:

```ts
box.offsetHeight; // read it and drop it
```

A forced layout read is only expensive because the browser must hand you a *truthful* value. If the value is provably unused, an engine is free to skip the work — and then the lab would be measuring nothing while claiming to measure a reflow.

So no read is ever discarded. Every technique feeds its reads into `sinkLayoutRead`, which accumulates them in a ref. Every 30 frames, the loop stamps the running total into the DOM:

```ts
gridRef.current.dataset.sink = String(layoutReadSink.current | 0);
```

The values now observably escape into the document. The engine can never prove them dead, so it can never skip the reflow.

The benchmark does the same trick with a `data-checksum` attribute — which doubles as an honesty check that both of its loops did identical work.

## One job, two costs: the scroll-tracking pair

Two toggles do the *same visible job*: as the scroll area drifts up and down, they highlight the box currently at the top of the view — the way a docs site's table of contents highlights the heading you're reading. A yellow box sweeps through the grid. That is the "active heading."

The janky version is the one most codebases ship. It listens to scroll and asks every box where it is:

    scroll event fires
    ↓
    getBoundingClientRect() × N boxes            (reads)
    ↓
    move the highlight class to the nearest box   (write → layout dirty)
    ↓
    next scroll event: the first read pays a full forced reflow

That last arrow is the part that hides from code review.

No single handler call looks wrong. The reads are "just reads." The write is one class flip. Inside one event, read-read-read-then-write is even the *correct* order.

The thrash only exists **across events**: every event's write poisons the next event's first read. Frame after frame, forever, for as long as the user scrolls. In a real React TOC the write is sneakier still — it's a `setState` whose DOM commit lands between events, so the dirtying write isn't even visible in the handler you're reviewing.

The IntersectionObserver version deletes the reads instead of reordering them:

```ts
const observer = new IntersectionObserver(
  (observerEntries) => {
    // The browser already did the geometry, off the hot path. This
    // handler never reads the DOM — there is nothing left to force.
    for (const entry of observerEntries) {
      if (entry.isIntersecting) boxesInZone.add(entry.target);
      else boxesInZone.delete(entry.target);
    }
    highlightFirstBoxInZone();
  },
  { root: scrollArea, rootMargin: "0px 0px -85% 0px", threshold: 0 },
);
for (const box of boxes) observer.observe(box);
```

The zone is described **once**: the observer's root is the scroll area, and the `rootMargin` of `0px 0px -85% 0px` shaves 85% off the bottom, so only the top 15% of the viewport counts as "the zone." From then on the browser computes intersections on its own schedule and calls back with ready-made entries — each one even carries a precomputed `boundingClientRect`, free.

The handler maintains a Set of boxes currently in the zone, picks the first one in document order (the Map from element to index is built once, at enable), and flips one class.

It still *writes* — the highlight moves, layout gets dirtied, the browser reflows once before the next paint, exactly as designed. What's gone is the *asking*. No geometry question is ever put to the DOM, so there is no read for the dirty layout to ambush.

Both toggles share the same auto-scroll driver (one `autoScrollForFrame` helper), so the motion is identical and only the tracking cost differs. Tick them one at a time: same sweeping highlight, one meter craters, one stays green.

This pair isn't hypothetical. A production docs TOC that tracked its active heading the janky way — scroll listener, rect reads per heading, React state write — was refactored to exactly this IntersectionObserver shape. Measured before and after: layout reads per frame fell from 25.2 to 3.6, and the share of frames with thrashing fell from 60% to 6%. Same highlight, same UX, an order of magnitude less main-thread work.

## The meter: from deltas to numbers

`lib/metrics.ts` has no React in it. It is a factory, `createFrameMeter()`, with two jobs: swallow deltas, and answer snapshots.

First, the naive version of the math it refuses to do:

```ts
const budget = 1000 / 60; // 16.7ms, right?
```

Wrong on a 120Hz ProMotion MacBook, where the budget is 8.3ms. Hardcoding 60 would mislabel real jank as healthy and cap an honest 120 FPS reading at half its value.

So the meter **detects** the refresh rate instead of assuming it. Every delta first passes through the intake:

```ts
const pushFrame = (frameDeltaMs: number) => {
  // A gap over 1,000ms is a backgrounded tab or a paused debugger,
  // not a rendered frame — it must not pollute the stats.
  const isRenderedFrame = frameDeltaMs > 0 && frameDeltaMs <= MAX_PLAUSIBLE_FRAME_MS;
  if (!isRenderedFrame) return;

  recentDeltasMs.push(frameDeltaMs);
  if (recentDeltasMs.length > FRAME_RING_CAPACITY) recentDeltasMs.shift();  // keep 180

  if (!isRefreshRateLocked) {
    hzDetectionSamplesMs.push(frameDeltaMs);
    const hasEnoughSamples = hzDetectionSamplesMs.length >= HZ_DETECTION_SAMPLE_COUNT;
    if (hasEnoughSamples) lockRefreshRate();  // after 40 idle frames
  }
};
```

What gets **stored** is exactly this: one rolling array of the last 180 deltas, oldest shifted out, plus two long-task counters. That is the meter's entire state.

The first 40 deltas also feed the refresh-rate detection:

```ts
const lockRefreshRate = () => {
  const medianDeltaMs = median(hzDetectionSamplesMs);
  const hasUsableSample = medianDeltaMs > 0;
  if (!hasUsableSample) return;
  const estimatedHz = MS_PER_SECOND / medianDeltaMs;
  detectedHz = snapToNearestRefreshRate(estimatedHz);  // → 60, 75, 90, 120, 144, 165, 240
  isRefreshRateLocked = true;
};
```

The **median** — not the average — because the first frames after page load are often janky, and a median shrugs outliers off. On a 120Hz MacBook the idle median lands around 8.35ms; `1000 / 8.35 = 119.8`, which snaps to the nearest common rate: **120**. Until those 40 samples lock in, the meter assumes 60 so no early math divides by garbage.

From the locked rate comes the number in the panel's top-right corner: `budget = 1000 / 120 = 8.3ms`. That is the time one frame is *allowed* to take.

## Reading a real panel, number by number

Take an idle panel on that 120Hz MacBook:

    120 Hz · 8.3 ms budget
    FPS 120 · Frame 8.3 ms · Worst 9.3 ms · Jank 0 %

Every one of those is computed fresh inside `snapshot()`, from the same 180-delta ring. Here is each formula, with these exact numbers traced through it.

**Frame — the average of the last 30 deltas.**

```ts
const averagingWindow = recentDeltasMs.slice(-FPS_AVERAGING_FRAMES);  // last 30
const avgFrameMs = average(averagingWindow);
```

Thirty frames is a quarter-second at 120Hz — enough smoothing that the readout doesn't twitch, short enough that real jank shows up within a beat. Idle deltas hover around 8.3, so the average reads **8.3 ms**.

**FPS — the same average, inverted and capped.**

```ts
const measuredFps = avgFrameMs > 0 ? MS_PER_SECOND / avgFrameMs : detectedHz;
const fps = Math.min(detectedHz, Math.round(measuredFps));
```

`1000 / 8.3 = 120.5`, rounds to 121 — and here is why the cap exists. The display cannot show more frames than vsync allows; a reading above the refresh rate is timer jitter, not speed. `Math.min(120, 121)` clamps it to **120**.

So FPS and Frame are the *same measurement* worn two ways. One is the inverse of the other.

**Worst — the maximum delta in the last second.**

```ts
const lastSecondFrameCount = Math.round(detectedHz);            // 120 frames ≈ 1s
const worstWindow = recentDeltasMs.slice(-lastSecondFrameCount);
const worstFrameMs = worstWindow.reduce((worst, delta) => Math.max(worst, delta), 0);
```

The average hides single hiccups; this exposes them. One frame in the last 120 took **9.3 ms** — a millisecond over budget. That is why the card shows yellow while everything else is green: real, but harmless.

**Jank % — how many recent frames were *seriously* late.**

```ts
const jankWindow = recentDeltasMs.slice(-JANK_WINDOW_FRAMES);   // last 90
const jankThresholdMs = budgetMs * JANK_BUDGET_MULTIPLIER;      // 8.3 × 1.5 = 12.5ms
const jankyFrameCount = jankWindow.filter((delta) => delta > jankThresholdMs).length;
const jankPercent = Math.round((jankyFrameCount / jankWindow.length) * 100);
```

Note the multiplier. A frame is not "janky" at 8.4ms — barely over budget is noise. It counts once it blows the budget by half again: 12.5ms here. Our worst frame was 9.3, under the threshold, so zero of the last 90 frames qualify: **0 %**.

**The sparkline — the last 64 raw deltas, drawn honestly.**

Each bar's height and color come from `Metrics.tsx`:

```ts
// height: full scale = 4× the budget, so a 33ms frame maxes out at 120Hz
const barHeightPercent = (frameMs: number, budgetMs: number): number => {
  const ceilingMs = budgetMs * SPARKLINE_MAX_BUDGET_MULTIPLE;   // budget × 4
  const fraction = ceilingMs > 0 ? Math.min(1, frameMs / ceilingMs) : 0;
  return fraction * PERCENT_MAX;
};

// color: green within budget, yellow to 1.5×, red beyond
const frameTimeHealth = (frameMs: number, budgetMs: number): HealthLevel => {
  if (frameMs <= budgetMs) return "good";
  if (frameMs <= budgetMs * OVER_BUDGET_WARN_MULTIPLE) return "warn";
  return "bad";
};
```

This explains something that looks alarming at idle: the sparkline is a mix of green and yellow bars even when FPS reads a solid 120. Those yellow bars are frames at 8.4–9.3ms — a fraction of a millisecond over an 8.33ms budget. On a 120Hz display the budget is so tight that ordinary timer jitter straddles the line. The jank counter is the tell: 0% means none of it matters.

**Long tasks — the one number that isn't derived from deltas.**

```ts
const observer = new PerformanceObserver((entryList) => {
  for (const entry of entryList.getEntries()) {
    longTaskCount += 1;
    longTaskMs += entry.duration;
  }
});
observer.observe({ entryTypes: ["longtask"] });
```

The browser itself reports every main-thread block over 50ms; the meter just counts them and sums their duration. `0 · 0 ms` at idle. (Chromium only — Firefox and Safari don't ship the `longtask` entry type, and the panel says "not supported" instead.)

**The card colors** are plain thresholds on top of all this, also in `Metrics.tsx`:

```ts
const HEALTHY_FPS_RATIO = 0.9;   // green at ≥108 of 120
const DEGRADED_FPS_RATIO = 0.5;  // yellow down to 60, red below
const JANK_WARN_PERCENT = 5;     // jank yellow at 5%
const JANK_BAD_PERCENT = 25;     // red at 25%
```

Notice FPS health is a *ratio of the detected rate*, never an absolute. 60 FPS is a perfect green on a 60Hz office monitor and a flaming red on a 120Hz MacBook — same number, different display, and the meter knows the difference because it measured the display first.

Now flip the running example on: forced reflow loop, 1,000 boxes. The deltas jump from ~8ms to ~200ms. Within a quarter second the 30-frame average drags up, FPS reads `min(120, 1000/200) = 5`, Worst pins at ~200, every frame in the 90-frame window clears the 12.5ms threshold — Jank 100% — and the sparkline becomes a wall of full-height red bars. Same formulas, no special cases. The numbers just follow the deltas.

## Keeping the instrument out of its own reading

A measurement tool inside a React app has an obvious failure mode: measure on every frame, `setState` on every frame, re-render 120 times a second — and now the meter is measuring its own re-renders.

The lab has three guards against that.

**Metrics flush at 5Hz, not per frame.** The loop calls `setMetrics` only when 200ms have passed. Fast enough to feel live. Slow enough that React's work is a rounding error in the thing being measured.

**The grid never re-renders on a metrics tick.** `Playground` is wrapped in `memo`, and the 1,000 box elements are built inside a `useMemo` keyed on `boxCount` alone. A metrics update re-renders the numbers panel; the boxes don't hear about it.

**The slider debounces.** Rebuilding hundreds of DOM nodes on every drag step would be jank of the lab's own making, blamed on whatever checkbox happens to be ticked. So the dragged value commits only after 140ms of quiet.

And underneath all three: the baseline. The boxes drift via a pure-`transform` CSS keyframe animation — compositor-only, main thread idle. At rest the meter reads a flat 120 (or whatever your display does). Every toggle is measured against that idle control.

## When the box count changes

The slider commit sets `boxCount`, which triggers a chain:

    boxCount commits (after the 140ms debounce)
    ↓
    Playground's useMemo rebuilds — fresh box elements
    ↓
    an effect fires: collectBoxes() re-runs querySelectorAll("[data-box]")
    ↓
    syncTechniques(enabledIds, rebuildAll: true)
    ↓
    all old teardowns run (their elements are gone),
    then every still-ticked technique re-enables onto the new boxes

That `rebuildAll: true` is the reconciler's second mode. It is why a ticked checkbox survives a slider drag: torn down against the dead grid, immediately re-enabled against the live one.

## The benchmark: the other instrument

The live meter is passive — it watches whatever is happening. The **Thrash vs batched** button is the opposite: an active, synchronous experiment that answers one question. *Same work, two orderings — how much slower is interleaving?*

It runs in `components/Benchmark.tsx`, entirely separate from the frame loop:

- Build 2,000 divs into a hidden stage, batched through a `DocumentFragment`.
- **Thrash trial:** per node — write `paddingTop`, read `offsetHeight`, write, read. Interleaved, 4,000 forced reflows.
- **Batched trial:** all 2,000 writes, then all 2,000 reads, then again — two reflows total for the same mutations.
- One *discarded* run of each first, so JIT warm-up and the first layout don't skew trial 1.
- Then 5 timed trials of each, alternating, timed with `performance.now()`. Between trials it awaits a `requestAnimationFrame`, so no trial inherits the previous one's dirty frame — and each trial is preceded by a deliberate layout flush so it starts from clean geometry.
- The reported numbers are the **median of 5** — one stray GC pause can't fake a result.

One small courtesy of the async shape: `runBenchmark` awaits a single animation frame before blocking, so the button gets to paint "Running…" before the main thread disappears for a couple of seconds.

The reported result is three lines of arithmetic:

```ts
const thrashMs = roundToTenths(median(thrashSamplesMs));
const batchedMs = roundToTenths(median(batchedSamplesMs));
const speedup = batchedMs > 0 ? Math.round(thrashMs / batchedMs) : 0;
```

The `×` number in the callout is nothing fancier than the ratio of the two medians. And the two bars are those medians drawn with `transform: scaleX(...)` — because a performance demo that animated `width` would be telling on itself.

## What the lab honestly can't see

The meter watches one thread: the main thread, via `requestAnimationFrame` timing.

That makes it structurally blind to compositor work. The "Paint bomb" toggle exists to prove it: heavy blur and shadows repainted every frame make the boxes visibly stutter while the FPS meter stays pinned and green — because rasterizing blur happens on the compositor thread, which the meter cannot observe. The lab keeps that blind spot on purpose. It is the lesson. (To see paint cost, you need DevTools → Rendering → Frame Rendering Stats, not a rAF counter.)

Two more limits, stated plainly:

- FPS is capped at the detected refresh rate. It answers "is the main thread keeping up with vsync," never "how fast could this go."
- The long-task readout needs the `longtask` PerformanceObserver, which Firefox and Safari don't ship. The panel degrades to saying so.

And the benchmark's number is a ratio demo, not a spec — 10× on one machine, 100× on another, depending on CPU, DOM size, and browser. The *shape* of the result is the point.

## The whole machine, in three beats

The registry describes each anti-pattern as data — a checkbox's copy and its sabotage in one object.

The reconciler turns the ticked set into per-frame work, with a teardown for every enable.

The meter never does any work — it just times the gaps the damage leaves between frames.
