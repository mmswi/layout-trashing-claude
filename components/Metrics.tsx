import type { MetricsSnapshot } from "@/lib/metrics";
import styles from "./Metrics.module.css";

// FPS health, as a fraction of the display's real refresh rate.
const HEALTHY_FPS_RATIO = 0.9;
const DEGRADED_FPS_RATIO = 0.5;

// Frame time health, as a multiple of the frame budget.
const OVER_BUDGET_WARN_MULTIPLE = 1.5;

// Jank percentage thresholds for the readout color.
const JANK_WARN_PERCENT = 5;
const JANK_BAD_PERCENT = 25;

// A sparkline bar maxes out its height at budget × this.
const SPARKLINE_MAX_BUDGET_MULTIPLE = 4;
const PERCENT_MAX = 100;

type HealthLevel = "good" | "warn" | "bad";

type Props = {
  metrics: MetricsSnapshot | null;
  longTasksSupported: boolean;
};

const fpsHealth = (fps: number, detectedHz: number): HealthLevel => {
  const ratio = detectedHz > 0 ? fps / detectedHz : 0;
  if (ratio >= HEALTHY_FPS_RATIO) return "good";
  if (ratio >= DEGRADED_FPS_RATIO) return "warn";
  return "bad";
};

const frameTimeHealth = (frameMs: number, budgetMs: number): HealthLevel => {
  if (frameMs <= budgetMs) return "good";
  if (frameMs <= budgetMs * OVER_BUDGET_WARN_MULTIPLE) return "warn";
  return "bad";
};

const jankHealth = (jankPercent: number): HealthLevel => {
  if (jankPercent < JANK_WARN_PERCENT) return "good";
  if (jankPercent < JANK_BAD_PERCENT) return "warn";
  return "bad";
};

const barHeightPercent = (frameMs: number, budgetMs: number): number => {
  const ceilingMs = budgetMs * SPARKLINE_MAX_BUDGET_MULTIPLE;
  const fraction = ceilingMs > 0 ? Math.min(1, frameMs / ceilingMs) : 0;
  return fraction * PERCENT_MAX;
};

export const Metrics = ({ metrics, longTasksSupported }: Props) => {
  if (!metrics) {
    return <div className={styles.panel}>measuring the display…</div>;
  }

  const {
    detectedHz,
    fps,
    avgFrameMs,
    worstFrameMs,
    jankPercent,
    longTaskCount,
    longTaskMs,
    budgetMs,
    recentFrameMs,
  } = metrics;

  const statCards = [
    { key: "fps", label: "FPS", value: fps, unit: "", health: fpsHealth(fps, detectedHz) },
    {
      key: "frame",
      label: "Frame",
      value: avgFrameMs,
      unit: "ms",
      health: frameTimeHealth(avgFrameMs, budgetMs),
    },
    {
      key: "worst",
      label: "Worst",
      value: worstFrameMs,
      unit: "ms",
      health: frameTimeHealth(worstFrameMs, budgetMs),
    },
    {
      key: "jank",
      label: "Jank",
      value: jankPercent,
      unit: "%",
      health: jankHealth(jankPercent),
    },
  ];

  const longTaskReadout = longTasksSupported
    ? `${longTaskCount} · ${longTaskMs} ms`
    : "not supported in this browser";

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>Main-thread health</span>
        <span className={`${styles.display} mono`}>
          {detectedHz} Hz · {budgetMs} ms budget
        </span>
      </div>

      <div className={styles.stats}>
        {statCards.map((card) => (
          <div key={card.key} className={styles.stat} data-health={card.health}>
            <span className={styles.statLabel}>{card.label}</span>
            <span className={styles.statValue}>
              {card.value}
              {card.unit ? <span className={styles.statUnit}> {card.unit}</span> : null}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.sparkline} aria-hidden="true">
        {recentFrameMs.map((frameMs, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: bars are a fixed-position rolling window
            key={index}
            className={styles.bar}
            data-health={frameTimeHealth(frameMs, budgetMs)}
            style={{ height: `${barHeightPercent(frameMs, budgetMs)}%` }}
          />
        ))}
      </div>

      <div className={styles.longtasks}>
        <span>Long tasks (&gt;50ms)</span>
        <span className="mono">{longTaskReadout}</span>
      </div>
    </div>
  );
};
