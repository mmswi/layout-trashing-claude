import { Lab } from "@/components/Lab";
import styles from "./page.module.css";

// The pipeline stages the legend explains, in pipeline order. Composite is the
// cheap one the baseline animation rides; layout is the villain most toggles
// trigger. Style and Layout run on the main thread; raster and composite don't.
const PIPELINE_STAGES = [
  { key: "style", label: "Style", note: "which rules apply — rarely the bottleneck" },
  { key: "layout", label: "Layout", note: "geometry — the expensive one, main thread" },
  { key: "paint", label: "Paint", note: "pixels — scales with area" },
  { key: "composite", label: "Composite", note: "transform / opacity — cheap, GPU" },
];

const Home = () => {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Rendering performance · interactive</p>
        <h1 className={styles.title}>Layout Thrashing Lab</h1>
        <p className={styles.lede}>
          Tick a box to inject a specific rendering anti-pattern into a live animation loop, then
          watch it show up in the frame metrics. Everything runs on your machine, calibrated to your
          display&apos;s real refresh rate.
        </p>
      </header>

      <section className={styles.primer}>
        <article>
          <h2>1 · The browser batches layout</h2>
          <p>
            Changing the DOM does not recompute anything. A write just marks layout dirty — the plan
            is to recompute geometry once, right before the next paint, no matter how many writes
            your code makes. Clean layout is cached and free to read. Dirty layout is a promise to
            recompute <em>later</em>.
          </p>
        </article>
        <article>
          <h2>2 · Reads turn &quot;later&quot; into &quot;right now&quot;</h2>
          <p>
            Ask for a geometry value — offsetHeight, getBoundingClientRect, getComputedStyle — while
            layout is dirty, and the browser must reflow synchronously to answer truthfully. In a
            loop that is N reflows per frame instead of one. The fix never changes: batch every
            read, then every write. One pair on one element is a rounding error; the scale is the
            whole difference.
          </p>
        </article>
        <article>
          <h2>3 · Expensive frames, and a meter that can lie</h2>
          <p>
            transform and opacity ride the compositor. top, left, width and margin re-run layout
            every frame; big shadows and blur re-paint every frame — on the compositor thread, where
            a main-thread FPS meter cannot see the cost. Always know which thread your metric is
            watching.
          </p>
        </article>
      </section>

      <ul className={styles.legend}>
        {PIPELINE_STAGES.map((stage) => (
          <li key={stage.key} className={styles.legendItem}>
            <span className={styles.legendDot} data-stage={stage.key} />
            <span className={styles.legendLabel}>{stage.label}</span>
            <span className={styles.legendNote}>{stage.note}</span>
          </li>
        ))}
      </ul>

      <Lab />

      <footer className={styles.footer}>
        <span>Built to be broken on purpose.</span>
        <span>
          Sources:{" "}
          <a
            href="https://gist.github.com/paulirish/5d52fb081b3570c81e3a"
            target="_blank"
            rel="noreferrer"
          >
            what forces layout
          </a>{" "}
          ·{" "}
          <a
            href="https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing"
            target="_blank"
            rel="noreferrer"
          >
            web.dev
          </a>
        </span>
      </footer>
    </div>
  );
};

export default Home;
