"use client";

import { useRef, useState } from "react";
import { median, roundToTenths } from "@/lib/stats";
import styles from "./Benchmark.module.css";

const BENCHMARK_NODE_COUNT = 2000;
const BENCHMARK_TRIAL_COUNT = 5;

// The two padding values the benchmark toggles. Any real layout change works;
// padding keeps each node's outer size fixed so the strip stays tidy.
const PADDING_STATE_A = "1px";
const PADDING_STATE_B = "0px";

// Smallest visible bar, so a huge speedup still leaves the "batched" bar drawable.
const MIN_BATCHED_SCALE = 0.02;

type BenchmarkResult = {
  thrashMs: number;
  batchedMs: number;
  speedup: number;
  nodeCount: number;
};

const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const createBenchmarkNodes = (
  stage: HTMLDivElement,
  count: number,
  nodeClass: string,
): HTMLElement[] => {
  const fragment = document.createDocumentFragment();
  const nodes: HTMLElement[] = [];
  for (let index = 0; index < count; index += 1) {
    const node = document.createElement("div");
    node.className = nodeClass;
    fragment.appendChild(node);
    nodes.push(node);
  }
  stage.replaceChildren(fragment);
  return nodes;
};

export const Benchmark = () => {
  const stageRef = useRef<HTMLDivElement>(null);
  // Keeps the forced-layout reads from being optimized away — the read only
  // costs anything if its result is used.
  const layoutReadSink = useRef(0);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const flushPendingLayout = (stage: HTMLDivElement) => {
    layoutReadSink.current += stage.offsetHeight;
  };

  const runThrashTrial = (nodes: HTMLElement[]): number => {
    const start = performance.now();
    let sink = 0;
    for (const node of nodes) {
      node.style.paddingTop = PADDING_STATE_A; // WRITE → layout dirty
      sink += node.offsetHeight; // READ → forced reflow
      node.style.paddingTop = PADDING_STATE_B; // WRITE → layout dirty
      sink += node.offsetHeight; // READ → forced reflow
    }
    layoutReadSink.current += sink;
    return performance.now() - start;
  };

  const runBatchedTrial = (nodes: HTMLElement[]): number => {
    const start = performance.now();
    let sink = 0;
    for (const node of nodes) node.style.paddingTop = PADDING_STATE_A; // all writes
    for (const node of nodes) sink += node.offsetHeight; // all reads → one reflow
    for (const node of nodes) node.style.paddingTop = PADDING_STATE_B; // all writes
    for (const node of nodes) sink += node.offsetHeight; // all reads → one reflow
    layoutReadSink.current += sink;
    return performance.now() - start;
  };

  const runBenchmark = async () => {
    const stage = stageRef.current;
    if (!stage || isRunning) return;

    setIsRunning(true);
    setResult(null);
    // Let React paint the "Running…" state before we block the main thread.
    await nextAnimationFrame();

    const nodes = createBenchmarkNodes(stage, BENCHMARK_NODE_COUNT, styles.node);

    // One discarded run of each, so JIT warm-up and first-layout don't skew trial 1.
    flushPendingLayout(stage);
    runThrashTrial(nodes);
    flushPendingLayout(stage);
    runBatchedTrial(nodes);

    const thrashSamplesMs: number[] = [];
    const batchedSamplesMs: number[] = [];
    for (let trial = 0; trial < BENCHMARK_TRIAL_COUNT; trial += 1) {
      flushPendingLayout(stage);
      thrashSamplesMs.push(runThrashTrial(nodes));
      await nextAnimationFrame();
      flushPendingLayout(stage);
      batchedSamplesMs.push(runBatchedTrial(nodes));
      await nextAnimationFrame();
    }

    stage.replaceChildren();
    stage.dataset.checksum = String(layoutReadSink.current | 0);

    const thrashMs = roundToTenths(median(thrashSamplesMs));
    const batchedMs = roundToTenths(median(batchedSamplesMs));
    const speedup = batchedMs > 0 ? Math.round(thrashMs / batchedMs) : 0;

    setResult({ thrashMs, batchedMs, speedup, nodeCount: BENCHMARK_NODE_COUNT });
    setIsRunning(false);
  };

  const hasResult = result !== null;
  const batchedScaleX =
    hasResult && result.thrashMs > 0
      ? Math.max(MIN_BATCHED_SCALE, result.batchedMs / result.thrashMs)
      : 0;

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Thrash vs batched</h3>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            runBenchmark();
          }}
          disabled={isRunning}
        >
          {isRunning ? "Running…" : "Run benchmark"}
        </button>
      </div>

      <p className={styles.blurb}>
        Identical work on {BENCHMARK_NODE_COUNT.toLocaleString()} nodes: interleaved read/write
        versus every read first, then every write. Median of {BENCHMARK_TRIAL_COUNT} runs.
      </p>

      {hasResult ? (
        <div className={styles.result}>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>Thrash</span>
            <div className={styles.track}>
              <div
                className={`${styles.fill} ${styles.fillBad}`}
                style={{ transform: "scaleX(1)" }}
              />
            </div>
            <span className={`${styles.barValue} mono`}>{result.thrashMs} ms</span>
          </div>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>Batched</span>
            <div className={styles.track}>
              <div
                className={`${styles.fill} ${styles.fillGood}`}
                style={{ transform: `scaleX(${batchedScaleX})` }}
              />
            </div>
            <span className={`${styles.barValue} mono`}>{result.batchedMs} ms</span>
          </div>
          <p className={styles.callout}>
            <strong className="mono">{result.speedup}×</strong> slower for identical work.
          </p>
        </div>
      ) : null}

      <div ref={stageRef} className={styles.stage} aria-hidden="true" />
    </div>
  );
};
