/**
 * The jank catalog. Each Technique is one checkbox: a real, isolated rendering
 * pattern the Lab injects into its animation frame loop so you can watch a
 * specific cost — or its deliberate absence — show up in the metrics. Most
 * entries are anti-patterns; two are healthy controls (the batched fix and a
 * single read-write pair) that do real work and stay green on purpose.
 *
 * NOTE: this is the one file that ships the anti-patterns Mihai's coding
 * standards forbid (interleaved read/write, transition:all, animating layout
 * props). That is the point — they are the subject under study, each labeled.
 * See CLAUDE.md. Do not "fix" them.
 */

// Where a technique's cost lands in the pipeline: JS → Style → Layout → Paint →
// Composite. Naming the stage lets the UI color-code toggles and explain the
// cost. The baseline motion (pure transform) is the "composite" counter-example.
export const PIPELINE_STAGE = {
  layout: "layout",
  paint: "paint",
  style: "style",
  composite: "composite",
} as const;
export type PipelineStage = (typeof PIPELINE_STAGE)[keyof typeof PIPELINE_STAGE];

// Whether a toggle demonstrates the disease or the cure. Anti-patterns crater
// the metrics; healthy controls do comparable work and stay green — they are
// the counter-examples the anti-patterns are measured against.
export const TECHNIQUE_KIND = {
  antiPattern: "anti-pattern",
  healthyControl: "healthy-control",
} as const;
export type TechniqueKind = (typeof TECHNIQUE_KIND)[keyof typeof TECHNIQUE_KIND];

export const TECHNIQUE_ID = {
  forcedReflowLoop: "forced-reflow-loop",
  batchedWriteRead: "batched-write-read",
  singleReadWritePair: "single-read-write-pair",
  animateLayoutProps: "animate-layout-props",
  transitionAll: "transition-all",
  jankyScrollHandler: "janky-scroll-handler",
  computedStyleLoop: "computed-style-loop",
  paintStorm: "paint-storm",
} as const;
export type TechniqueId = (typeof TECHNIQUE_ID)[keyof typeof TECHNIQUE_ID];

// Handles the Lab hands each technique. They are getters, not values, so a
// technique enabled before the box count changes still sees the current boxes.
export interface LabRefs {
  getBoxes: () => HTMLElement[];
  getScrollArea: () => HTMLElement | null;
  // A forced-layout read is only expensive if its value is used — otherwise the
  // engine could skip it. Techniques feed their reads here so the read can't be
  // dead-code-eliminated, and the Lab stamps the total into the DOM.
  sinkLayoutRead: (value: number) => void;
}

export interface FrameContext {
  frameIndex: number;
  timeMs: number;
}

// Returned by onEnable; run when the checkbox is unticked or the boxes rebuild.
export type TechniqueTeardown = (() => void) | undefined;

interface TechniqueBase {
  id: TechniqueId;
  label: string;
  stage: PipelineStage;
  summary: string;
  onEnable?: (refs: LabRefs) => TechniqueTeardown;
  onFrame?: (refs: LabRefs, frame: FrameContext) => void;
}

// The two variants carry differently-named explainers on purpose: an
// anti-pattern explains its cost and its fix; a healthy control explains why
// it stays cheap and what that proves. The UI narrows on `kind` for headings.
export interface AntiPatternTechnique extends TechniqueBase {
  kind: typeof TECHNIQUE_KIND.antiPattern;
  whySlow: string;
  theFix: string;
  badSnippet: string;
}

export interface HealthyControlTechnique extends TechniqueBase {
  kind: typeof TECHNIQUE_KIND.healthyControl;
  whyCheap: string;
  theLesson: string;
  goodSnippet: string;
}

export type Technique = AntiPatternTechnique | HealthyControlTechnique;

// Global classes from globals.css that techniques toggle on the boxes.
const TRANSITION_ALL_CLASS = "lt-transition-all";
const STATE_B_CLASS = "lt-state-b";
const PAINT_CLASS = "lt-paint";

// Tuning for the per-frame effects. Named so the intent reads at a glance.
const BORDER_FLICKER_PX = 2; // width the forced-reflow write toggles
const POSITION_WOBBLE_PX = 14; // swing of the layout-animated boxes
const POSITION_WOBBLE_SPEED = 0.002; // radians per ms
const POSITION_WOBBLE_STAGGER = 0.3; // phase offset per box, for a wave
const TRANSITION_TOGGLE_FRAMES = 22; // flip transition:all state every N frames
const PAINT_BLUR_BASE_PX = 4;
const PAINT_BLUR_SWING_PX = 8;
const PAINT_BLUR_SPEED = 0.004;
const AUTOSCROLL_SPEED = 0.0012; // how fast the janky-scroll demo self-scrolls

const isEvenFrame = (frameIndex: number): boolean => frameIndex % 2 === 0;

export const TECHNIQUES: Technique[] = [
  {
    id: TECHNIQUE_ID.forcedReflowLoop,
    kind: TECHNIQUE_KIND.antiPattern,
    label: "Forced reflow loop (read after write)",
    stage: PIPELINE_STAGE.layout,
    summary: "Writes a style, then reads geometry — for every box, every frame.",
    whySlow:
      "The browser batches layout: a write only marks it dirty, planning one reflow before the next paint. But offsetHeight must be a truthful, up-to-date number — so the read forces that reflow right now, mid-loop. N boxes means N full reflows in one frame instead of one.",
    theFix:
      "Batch it: do all the reads first while layout is still clean, then all the writes. One reflow, not N. Tick the batched control below to watch the same work stay green.",
    badSnippet: `for (const box of boxes) {
  box.style.borderTopWidth = flicker; // WRITE → layout dirty
  read(box.offsetHeight);             // READ → forced sync reflow
}`,
    onEnable: (refs) => () => {
      for (const box of refs.getBoxes()) box.style.borderTopWidth = "";
    },
    onFrame: (refs, frame) => {
      const flickerWidthPx = isEvenFrame(frame.frameIndex) ? "0px" : `${BORDER_FLICKER_PX}px`;
      for (const box of refs.getBoxes()) {
        // WRITE — invalidates layout.
        box.style.borderTopWidth = flickerWidthPx;
        // READ — forces the browser to recompute layout right now. Once per box.
        refs.sinkLayoutRead(box.offsetHeight);
      }
    },
  },
  {
    id: TECHNIQUE_ID.batchedWriteRead,
    kind: TECHNIQUE_KIND.healthyControl,
    label: "Batched writes, then reads (the fix)",
    stage: PIPELINE_STAGE.layout,
    summary: "The forced-reflow loop's exact work — batched instead of interleaved.",
    whyCheap:
      "Same writes, same reads, different order. All the writes land while layout is dirty anyway; the first read flushes layout once and every read after it hits the clean cache. N reflows per frame become one.",
    theLesson:
      "Tick this and the forced-reflow loop one at a time at the same box count. Identical work — one stays green, one craters. The order is the whole difference.",
    goodSnippet: `for (const box of boxes) box.style.borderTopWidth = flicker; // all writes
for (const box of boxes) read(box.offsetHeight); // all reads → ONE reflow`,
    onEnable: (refs) => () => {
      for (const box of refs.getBoxes()) box.style.borderTopWidth = "";
    },
    onFrame: (refs, frame) => {
      const flickerWidthPx = isEvenFrame(frame.frameIndex) ? "0px" : `${BORDER_FLICKER_PX}px`;
      const boxes = refs.getBoxes();
      // Every write first — layout goes dirty once, no matter how many boxes.
      for (const box of boxes) box.style.borderTopWidth = flickerWidthPx;
      // Then every read — the first one flushes layout; the rest are cache hits.
      for (const box of boxes) refs.sinkLayoutRead(box.offsetHeight);
    },
  },
  {
    id: TECHNIQUE_ID.singleReadWritePair,
    kind: TECHNIQUE_KIND.healthyControl,
    label: "One read-write pair, one box",
    stage: PIPELINE_STAGE.layout,
    summary: "The forbidden write→read — but once, on a single box, per frame.",
    whyCheap:
      "This is the exact write→read the forced-reflow jank loop commits, and the metrics don't move. One flush on one element is a rounding error against the frame budget. A thousand of them in a loop is a frozen page.",
    theLesson:
      "Thrashing is not “a read after a write” — it is that pair repeated across many elements, many times per frame. The auto-growing textarea that reads scrollHeight right after a write is fine. The scale is the whole difference.",
    goodSnippet: `firstBox.style.borderTopWidth = flicker; // WRITE
read(firstBox.offsetHeight); // READ → one reflow. Once. That's fine.`,
    onEnable: (refs) => () => {
      for (const box of refs.getBoxes()) box.style.borderTopWidth = "";
    },
    onFrame: (refs, frame) => {
      const [firstBox] = refs.getBoxes();
      if (!firstBox) return;
      firstBox.style.borderTopWidth = isEvenFrame(frame.frameIndex)
        ? "0px"
        : `${BORDER_FLICKER_PX}px`;
      refs.sinkLayoutRead(firstBox.offsetHeight);
    },
  },
  {
    id: TECHNIQUE_ID.animateLayoutProps,
    kind: TECHNIQUE_KIND.antiPattern,
    label: "Animate top / left (not transform)",
    stage: PIPELINE_STAGE.layout,
    summary: "Moves every box by writing top/left each frame.",
    whySlow:
      "top and left are layout properties: changing them re-runs layout and paint on every frame. transform draws the same motion by moving an already-painted layer on the compositor — same pixels, but one property re-runs the pipeline while the other skips to its last stage.",
    theFix: "Animate transform: translate() and opacity only — they run on the compositor thread.",
    badSnippet: `box.style.left = x + "px"; // layout every frame
box.style.top  = y + "px";
// fix: box.style.transform = \`translate(\${x}px, \${y}px)\``,
    onEnable: (refs) => () => {
      for (const box of refs.getBoxes()) {
        box.style.left = "";
        box.style.top = "";
      }
    },
    onFrame: (refs, frame) => {
      refs.getBoxes().forEach((box, index) => {
        const phase = frame.timeMs * POSITION_WOBBLE_SPEED + index * POSITION_WOBBLE_STAGGER;
        box.style.left = `${Math.sin(phase) * POSITION_WOBBLE_PX}px`;
        box.style.top = `${Math.cos(phase) * POSITION_WOBBLE_PX}px`;
      });
    },
  },
  {
    id: TECHNIQUE_ID.transitionAll,
    kind: TECHNIQUE_KIND.antiPattern,
    label: "transition: all",
    stage: PIPELINE_STAGE.layout,
    summary: "Sets transition:all, then flips several properties at once.",
    whySlow:
      "all opts every animatable property into the transition. You meant to fade a background — you also signed up to animate margin, a layout property, so the browser reflows frame after frame through the entire 380ms transition.",
    theFix: "Name the exact properties: transition: transform, opacity. Never all.",
    badSnippet: `.box { transition: all 380ms; }
/* flipping margin now animates LAYOUT for 380ms */`,
    onEnable: (refs) => {
      for (const box of refs.getBoxes()) box.classList.add(TRANSITION_ALL_CLASS);
      return () => {
        for (const box of refs.getBoxes()) {
          box.classList.remove(TRANSITION_ALL_CLASS, STATE_B_CLASS);
        }
      };
    },
    onFrame: (refs, frame) => {
      const isToggleFrame = frame.frameIndex % TRANSITION_TOGGLE_FRAMES === 0;
      if (!isToggleFrame) return;
      const cycle = Math.floor(frame.frameIndex / TRANSITION_TOGGLE_FRAMES);
      const shouldEnterStateB = isEvenFrame(cycle);
      for (const box of refs.getBoxes()) box.classList.toggle(STATE_B_CLASS, shouldEnterStateB);
    },
  },
  {
    id: TECHNIQUE_ID.jankyScrollHandler,
    kind: TECHNIQUE_KIND.antiPattern,
    label: "Janky scroll handler",
    stage: PIPELINE_STAGE.layout,
    summary: "On every scroll event, reads getBoundingClientRect for all boxes.",
    whySlow:
      "Scroll events fire many times a second, between frames. Each one forces a reflow per box — so the thing the user is touching is the thing that freezes. This demo auto-scrolls so you can watch it.",
    theFix:
      "The expensive part is the call, not the value: getBoundingClientRect returns a frozen DOMRect snapshot that is free to read later. Call once and cache it, throttle to requestAnimationFrame, or let IntersectionObserver report visibility off the main thread.",
    badSnippet: `scroller.addEventListener("scroll", () => {
  for (const box of boxes) box.getBoundingClientRect(); // forced reflow ×N / event
});`,
    onEnable: (refs) => {
      const scrollArea = refs.getScrollArea();
      if (!scrollArea) return;
      const handleScroll = () => {
        let nearestBoxOffset = Number.POSITIVE_INFINITY;
        for (const box of refs.getBoxes()) {
          // A forced reflow on every box, on every scroll event, on the main thread.
          const rect = box.getBoundingClientRect();
          nearestBoxOffset = Math.min(nearestBoxOffset, Math.abs(rect.top));
        }
        if (Number.isFinite(nearestBoxOffset)) refs.sinkLayoutRead(nearestBoxOffset);
      };
      scrollArea.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        scrollArea.removeEventListener("scroll", handleScroll);
        scrollArea.scrollTop = 0;
      };
    },
    onFrame: (refs, frame) => {
      const scrollArea = refs.getScrollArea();
      if (!scrollArea) return;
      const scrollableDistance = scrollArea.scrollHeight - scrollArea.clientHeight;
      if (scrollableDistance <= 0) return;
      const progress = (Math.sin(frame.timeMs * AUTOSCROLL_SPEED) + 1) / 2;
      scrollArea.scrollTop = progress * scrollableDistance;
    },
  },
  {
    id: TECHNIQUE_ID.computedStyleLoop,
    kind: TECHNIQUE_KIND.antiPattern,
    label: "getComputedStyle in a loop",
    stage: PIPELINE_STAGE.layout,
    summary: "Dirties layout, then reads a computed layout value per box.",
    whySlow:
      "getComputedStyle looks like a passive CSS lookup. It is not. Ask it for a layout-dependent value like height while layout is dirty and it forces the same synchronous reflow offsetHeight does — just wearing a different coat.",
    theFix:
      "Read computed styles once, outside the write loop — or avoid layout-dependent properties in hot paths entirely.",
    badSnippet: `box.style.paddingTop = flicker;              // WRITE
parseFloat(getComputedStyle(box).height);    // READ → forced reflow`,
    onEnable: (refs) => () => {
      for (const box of refs.getBoxes()) box.style.paddingTop = "";
    },
    onFrame: (refs, frame) => {
      const flickerPaddingPx = isEvenFrame(frame.frameIndex) ? "0px" : "1px";
      for (const box of refs.getBoxes()) {
        box.style.paddingTop = flickerPaddingPx; // WRITE → layout dirty
        const computedHeightPx = Number.parseFloat(getComputedStyle(box).height) || 0;
        refs.sinkLayoutRead(computedHeightPx); // READ → forced reflow
      }
    },
  },
  {
    id: TECHNIQUE_ID.paintStorm,
    kind: TECHNIQUE_KIND.antiPattern,
    label: "Paint bomb (compositor-bound)",
    stage: PIPELINE_STAGE.paint,
    summary: "Heavy blur + shadow, repainted every frame. Watch the boxes stutter — not the FPS.",
    whySlow:
      "Painting big blurred shadows over a thousand boxes is genuinely expensive, but paint and raster run on the compositor thread, not the main thread. The animation stutters while the rAF-based FPS meter above stays near your refresh rate. That gap is the point: a main-thread FPS counter is blind to paint jank.",
    theFix:
      "Shrink the blur radius and the painted area, or animate transform/opacity of an already-painted layer. To actually see paint cost, open DevTools → Rendering → Frame Rendering Stats — not a rAF FPS counter.",
    badSnippet: `box.style.filter = \`blur(\${blur}px)\`; // repaint every box, every frame
// the main-thread FPS meter won't move — the compositor is the one drowning`,
    onEnable: (refs) => {
      for (const box of refs.getBoxes()) box.classList.add(PAINT_CLASS);
      return () => {
        for (const box of refs.getBoxes()) {
          box.classList.remove(PAINT_CLASS);
          box.style.filter = "";
        }
      };
    },
    onFrame: (refs, frame) => {
      const swing = (Math.sin(frame.timeMs * PAINT_BLUR_SPEED) + 1) * PAINT_BLUR_SWING_PX;
      const blurPx = PAINT_BLUR_BASE_PX + swing;
      const filterValue = `blur(${blurPx.toFixed(2)}px) drop-shadow(0 0 6px rgba(248, 116, 110, 0.9))`;
      for (const box of refs.getBoxes()) box.style.filter = filterValue;
    },
  },
];

// The sidebar renders the catalog as two separate groups, so the jank list
// holds only anti-patterns and a fix can never be mistaken for one.
export const ANTI_PATTERN_TECHNIQUES = TECHNIQUES.filter(
  (technique) => technique.kind === TECHNIQUE_KIND.antiPattern,
);
export const HEALTHY_CONTROL_TECHNIQUES = TECHNIQUES.filter(
  (technique) => technique.kind === TECHNIQUE_KIND.healthyControl,
);
