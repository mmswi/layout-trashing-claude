import { memo, type RefObject, useMemo } from "react";
import styles from "./Playground.module.css";

// Each box starts its drift at a staggered offset so the grid ripples instead
// of pulsing in unison. The delay is set once per box at render, never per frame.
const ANIMATION_STAGGER_BUCKETS = 24;
const ANIMATION_STAGGER_STEP_S = 0.13;

type Props = {
  boxCount: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
};

const staggeredDelayFor = (index: number): string => {
  const bucket = index % ANIMATION_STAGGER_BUCKETS;
  return `${-(bucket * ANIMATION_STAGGER_STEP_S)}s`;
};

const PlaygroundComponent = ({ boxCount, scrollRef, gridRef }: Props) => {
  // Rebuild the box elements only when the count changes — never on a metrics
  // tick — so the frame loop measures the techniques, not React re-rendering.
  const boxes = useMemo(
    () =>
      Array.from({ length: boxCount }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional grid, boxes never reorder
          key={index}
          data-box=""
          className={styles.box}
          style={{ animationDelay: staggeredDelayFor(index) }}
        />
      )),
    [boxCount],
  );

  return (
    <div ref={scrollRef} className={styles.viewport}>
      <div ref={gridRef} className={styles.grid}>
        {boxes}
      </div>
    </div>
  );
};

export const Playground = memo(PlaygroundComponent);
