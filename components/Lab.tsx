"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Benchmark } from "@/components/Benchmark";
import { Metrics } from "@/components/Metrics";
import { Playground } from "@/components/Playground";
import { TechniqueList } from "@/components/TechniqueList";
import { createFrameMeter, type FrameMeter, type MetricsSnapshot } from "@/lib/metrics";
import {
  type FrameContext,
  type LabRefs,
  TECHNIQUES,
  type Technique,
  type TechniqueId,
} from "@/lib/techniques";
import styles from "./Lab.module.css";

// Default high enough that ticking the forced-reflow box obviously craters FPS;
// dial it down with the slider to find where the jank starts.
const DEFAULT_BOX_COUNT = 1000;
const MIN_BOX_COUNT = 50;
const MAX_BOX_COUNT = 3000;
const BOX_COUNT_STEP = 50;

// Push metrics to React at ~5Hz — fast enough to feel live, slow enough that our
// own re-renders don't show up in the measurement.
const METRICS_FLUSH_MS = 200;

// How often the accumulated forced-layout reads get stamped into the DOM, so the
// engine can never prove them dead and skip the reflow.
const SINK_STAMP_FRAMES = 30;

// Rebuilding hundreds of boxes on every drag step would jank on its own, so the
// slider commits its value only after it settles.
const BOX_COUNT_DEBOUNCE_MS = 140;

const noop = () => {};

export const Lab = () => {
  const [enabledIds, setEnabledIds] = useState<ReadonlySet<TechniqueId>>(
    () => new Set<TechniqueId>(),
  );
  const [boxCountInput, setBoxCountInput] = useState(DEFAULT_BOX_COUNT);
  const [boxCount, setBoxCount] = useState(DEFAULT_BOX_COUNT);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [longTasksSupported, setLongTasksSupported] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const boxesRef = useRef<HTMLElement[]>([]);
  const teardownsRef = useRef<Map<TechniqueId, () => void>>(new Map());
  const activeFrameTechniquesRef = useRef<Technique[]>([]);
  const enabledIdsRef = useRef<ReadonlySet<TechniqueId>>(enabledIds);
  const layoutReadSink = useRef(0);

  const rafIdRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const frameIndexRef = useRef(0);
  const lastMetricsFlushRef = useRef(0);

  const meterRef = useRef<FrameMeter | null>(null);
  if (meterRef.current === null) meterRef.current = createFrameMeter();

  // Stable handles the techniques read through, so one enabled before the box
  // count changes still sees the current boxes afterward.
  const labRefs = useMemo<LabRefs>(
    () => ({
      getBoxes: () => boxesRef.current,
      getScrollArea: () => scrollRef.current,
      sinkLayoutRead: (value: number) => {
        layoutReadSink.current += value;
      },
    }),
    [],
  );

  const collectBoxes = useCallback(() => {
    const grid = gridRef.current;
    boxesRef.current = grid ? Array.from(grid.querySelectorAll<HTMLElement>("[data-box]")) : [];
  }, []);

  // Bring the live techniques in line with `enabled`. When the boxes themselves
  // were replaced, `rebuildAll` tears everything down first, because the old
  // teardowns and classes point at elements that no longer exist.
  const syncTechniques = useCallback(
    (enabled: ReadonlySet<TechniqueId>, rebuildAll: boolean) => {
      const teardowns = teardownsRef.current;

      if (rebuildAll) {
        for (const teardown of teardowns.values()) teardown();
        teardowns.clear();
      }

      for (const [id, teardown] of teardowns) {
        const stillEnabled = enabled.has(id);
        if (!stillEnabled) {
          teardown();
          teardowns.delete(id);
        }
      }

      for (const technique of TECHNIQUES) {
        const shouldEnable = enabled.has(technique.id) && !teardowns.has(technique.id);
        if (shouldEnable) {
          const teardown = technique.onEnable?.(labRefs);
          teardowns.set(technique.id, teardown ?? noop);
        }
      }

      activeFrameTechniquesRef.current = TECHNIQUES.filter(
        (technique) => enabled.has(technique.id) && Boolean(technique.onFrame),
      );
    },
    [labRefs],
  );

  // Debounce the slider so a drag doesn't rebuild the grid on every step.
  useEffect(() => {
    const timer = window.setTimeout(() => setBoxCount(boxCountInput), BOX_COUNT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [boxCountInput]);

  // Reconcile whenever the checkboxes change.
  useEffect(() => {
    enabledIdsRef.current = enabledIds;
    syncTechniques(enabledIds, false);
  }, [enabledIds, syncTechniques]);

  // A committed box count means the grid re-rendered with fresh nodes: recollect
  // them and re-apply every active technique to the new elements.
  // biome-ignore lint/correctness/useExhaustiveDependencies: boxCount is the re-run trigger; the body reads current boxes through refs
  useEffect(() => {
    collectBoxes();
    syncTechniques(enabledIdsRef.current, true);
  }, [boxCount, collectBoxes, syncTechniques]);

  // The one animation-frame loop. Set up once; the airtight cleanup means Strict
  // Mode's dev double-mount can never leave a second loop running.
  useEffect(() => {
    const meter = meterRef.current;
    if (!meter) return;

    collectBoxes();
    setLongTasksSupported(meter.startLongTaskObserver());

    let isLoopActive = true;

    const step = (timestampMs: number) => {
      if (!isLoopActive) return;

      const lastTimestamp = lastFrameTimeRef.current;
      if (lastTimestamp !== null) meter.pushFrame(timestampMs - lastTimestamp);
      lastFrameTimeRef.current = timestampMs;

      const frame: FrameContext = { frameIndex: frameIndexRef.current, timeMs: timestampMs };
      for (const technique of activeFrameTechniquesRef.current) {
        technique.onFrame?.(labRefs, frame);
      }
      frameIndexRef.current += 1;

      const shouldStampSink = frameIndexRef.current % SINK_STAMP_FRAMES === 0;
      if (shouldStampSink && gridRef.current) {
        gridRef.current.dataset.sink = String(layoutReadSink.current | 0);
      }

      const shouldFlushMetrics = timestampMs - lastMetricsFlushRef.current >= METRICS_FLUSH_MS;
      if (shouldFlushMetrics) {
        setMetrics(meter.snapshot());
        lastMetricsFlushRef.current = timestampMs;
      }

      rafIdRef.current = requestAnimationFrame(step);
    };

    rafIdRef.current = requestAnimationFrame(step);

    return () => {
      isLoopActive = false;
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      lastFrameTimeRef.current = null;
      meter.stopLongTaskObserver();
      for (const teardown of teardownsRef.current.values()) teardown();
      teardownsRef.current.clear();
    };
  }, [collectBoxes, labRefs]);

  const handleToggle = useCallback((id: TechniqueId) => {
    setEnabledIds((previous) => {
      const next = new Set<TechniqueId>(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setEnabledIds(new Set<TechniqueId>());
    meterRef.current?.resetLongTasks();
  }, []);

  const enabledCount = enabledIds.size;
  const hasEnabled = enabledCount > 0;

  return (
    <div className={styles.lab}>
      <Metrics metrics={metrics} longTasksSupported={longTasksSupported} />

      <div className={styles.grid}>
        <section className={styles.controls}>
          <div className={styles.controlHead}>
            <h2 className={styles.controlTitle}>Jank toggles</h2>
            <button
              type="button"
              className={styles.reset}
              onClick={handleReset}
              disabled={!hasEnabled}
            >
              Reset{hasEnabled ? ` (${enabledCount})` : ""}
            </button>
          </div>

          <label className={styles.boxCount}>
            <span className={styles.boxCountLabel}>
              <span>Boxes</span>
              <strong className="mono">{boxCountInput.toLocaleString()}</strong>
            </span>
            <input
              type="range"
              min={MIN_BOX_COUNT}
              max={MAX_BOX_COUNT}
              step={BOX_COUNT_STEP}
              value={boxCountInput}
              onChange={(event) => setBoxCountInput(Number(event.target.value))}
              className={styles.slider}
            />
          </label>

          <TechniqueList techniques={TECHNIQUES} enabledIds={enabledIds} onToggle={handleToggle} />
        </section>

        <section className={styles.stage}>
          <Playground boxCount={boxCount} scrollRef={scrollRef} gridRef={gridRef} />
          <Benchmark />
        </section>
      </div>
    </div>
  );
};
