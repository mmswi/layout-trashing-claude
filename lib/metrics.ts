/**
 * FrameMeter — measures how healthy the main thread is, frame to frame.
 *
 * Everything here is calibrated to the display's *actual* refresh rate, which
 * we detect at rest instead of assuming 60Hz. On a 120Hz ProMotion Mac the
 * frame budget is 8.3ms, not 16.7 — hardcoding 60 would mislabel real jank as
 * healthy and cap a true reading at half its value.
 */

import { average, median, roundToTenths } from "@/lib/stats";

// Frames sampled at rest before we trust a refresh-rate estimate. Roughly
// 0.3–0.6s of idle frames — enough to median out a couple of janky first frames.
const HZ_DETECTION_SAMPLE_COUNT = 40;

// A raw estimate is snapped to the nearest of these, so 119.7 reads as 120.
const COMMON_REFRESH_RATES_HZ = [60, 75, 90, 120, 144, 165, 240] as const;

// Assumed until detection locks, so early math never divides by a wild value.
const FALLBACK_REFRESH_HZ = 60;

// A gap longer than this is a backgrounded tab or a paused debugger, not a
// rendered frame — it must not pollute fps or jank stats.
const MAX_PLAUSIBLE_FRAME_MS = 1000;

// How many recent frame deltas we keep for the rolling stats + sparkline.
const FRAME_RING_CAPACITY = 180;

// The smoothed fps / average-frame-time readout averages this many recent frames.
const FPS_AVERAGING_FRAMES = 30;

// A frame counts as "janky" once it runs longer than budget × this.
const JANK_BUDGET_MULTIPLIER = 1.5;

// Window (in frames) the jank percentage is measured over.
const JANK_WINDOW_FRAMES = 90;

// Bars shown in the frame-time sparkline.
const SPARKLINE_SAMPLE_COUNT = 64;

const LONG_TASK_ENTRY_TYPE = "longtask";
const MS_PER_SECOND = 1000;

export interface MetricsSnapshot {
  detectedHz: number;
  fps: number;
  avgFrameMs: number;
  worstFrameMs: number;
  jankPercent: number;
  longTaskCount: number;
  longTaskMs: number;
  budgetMs: number;
  recentFrameMs: number[];
}

export interface FrameMeter {
  pushFrame: (frameDeltaMs: number) => void;
  snapshot: () => MetricsSnapshot;
  startLongTaskObserver: () => boolean;
  stopLongTaskObserver: () => void;
  resetLongTasks: () => void;
}

const budgetMsForRefreshRate = (refreshHz: number): number => MS_PER_SECOND / refreshHz;

const isLongTaskObserverSupported = (): boolean => {
  const hasPerformanceObserver = typeof PerformanceObserver !== "undefined";
  if (!hasPerformanceObserver) return false;
  const supportedTypes = PerformanceObserver.supportedEntryTypes ?? [];
  return supportedTypes.includes(LONG_TASK_ENTRY_TYPE);
};

const snapToNearestRefreshRate = (estimatedHz: number): number =>
  COMMON_REFRESH_RATES_HZ.reduce((closestHz, candidateHz) =>
    Math.abs(candidateHz - estimatedHz) < Math.abs(closestHz - estimatedHz)
      ? candidateHz
      : closestHz,
  );

export const createFrameMeter = (): FrameMeter => {
  const recentDeltasMs: number[] = [];
  const hzDetectionSamplesMs: number[] = [];
  let detectedHz = FALLBACK_REFRESH_HZ;
  let isRefreshRateLocked = false;
  let longTaskCount = 0;
  let longTaskMs = 0;
  let longTaskObserver: PerformanceObserver | null = null;

  const lockRefreshRate = () => {
    const medianDeltaMs = median(hzDetectionSamplesMs);
    const hasUsableSample = medianDeltaMs > 0;
    if (!hasUsableSample) return;
    const estimatedHz = MS_PER_SECOND / medianDeltaMs;
    detectedHz = snapToNearestRefreshRate(estimatedHz);
    isRefreshRateLocked = true;
  };

  const pushFrame = (frameDeltaMs: number) => {
    const isRenderedFrame = frameDeltaMs > 0 && frameDeltaMs <= MAX_PLAUSIBLE_FRAME_MS;
    if (!isRenderedFrame) return;

    recentDeltasMs.push(frameDeltaMs);
    if (recentDeltasMs.length > FRAME_RING_CAPACITY) recentDeltasMs.shift();

    if (!isRefreshRateLocked) {
      hzDetectionSamplesMs.push(frameDeltaMs);
      const hasEnoughSamples = hzDetectionSamplesMs.length >= HZ_DETECTION_SAMPLE_COUNT;
      if (hasEnoughSamples) lockRefreshRate();
    }
  };

  const snapshot = (): MetricsSnapshot => {
    const budgetMs = budgetMsForRefreshRate(detectedHz);

    const averagingWindow = recentDeltasMs.slice(-FPS_AVERAGING_FRAMES);
    const avgFrameMs = average(averagingWindow);

    // "Worst frame in the last ~second" — one detectedHz's worth of frames.
    const lastSecondFrameCount = Math.round(detectedHz);
    const worstWindow = recentDeltasMs.slice(-lastSecondFrameCount);
    const worstFrameMs = worstWindow.reduce((worst, delta) => Math.max(worst, delta), 0);

    const jankWindow = recentDeltasMs.slice(-JANK_WINDOW_FRAMES);
    const jankThresholdMs = budgetMs * JANK_BUDGET_MULTIPLIER;
    const jankyFrameCount = jankWindow.filter((delta) => delta > jankThresholdMs).length;
    const jankPercent =
      jankWindow.length === 0 ? 0 : Math.round((jankyFrameCount / jankWindow.length) * 100);

    // fps is derived from the smoothed frame time, then capped at the refresh
    // rate — the display can't beat vsync, so anything above it is noise.
    const measuredFps = avgFrameMs > 0 ? MS_PER_SECOND / avgFrameMs : detectedHz;
    const fps = Math.min(detectedHz, Math.round(measuredFps));

    return {
      detectedHz,
      fps,
      avgFrameMs: roundToTenths(avgFrameMs),
      worstFrameMs: roundToTenths(worstFrameMs),
      jankPercent,
      longTaskCount,
      longTaskMs: Math.round(longTaskMs),
      budgetMs: roundToTenths(budgetMs),
      recentFrameMs: recentDeltasMs.slice(-SPARKLINE_SAMPLE_COUNT),
    };
  };

  const startLongTaskObserver = (): boolean => {
    const alreadyRunning = longTaskObserver !== null;
    if (alreadyRunning) return true;
    if (!isLongTaskObserverSupported()) return false;

    const observer = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        longTaskCount += 1;
        longTaskMs += entry.duration;
      }
    });
    observer.observe({ entryTypes: [LONG_TASK_ENTRY_TYPE] });
    longTaskObserver = observer;
    return true;
  };

  const stopLongTaskObserver = () => {
    longTaskObserver?.disconnect();
    longTaskObserver = null;
  };

  const resetLongTasks = () => {
    longTaskCount = 0;
    longTaskMs = 0;
  };

  return {
    pushFrame,
    snapshot,
    startLongTaskObserver,
    stopLongTaskObserver,
    resetLongTasks,
  };
};
