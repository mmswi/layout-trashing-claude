import { Lab } from "@/components/Lab";
import styles from "./page.module.css";

// The three pipeline stages the legend explains. Composite is the cheap one the
// baseline animation rides; layout is the villain most toggles trigger.
const PIPELINE_STAGES = [
  { key: "layout", label: "Layout", note: "geometry — the expensive one" },
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
          <h2>1 · Forced synchronous layout</h2>
          <p>
            Reading a geometry value — offsetHeight, getBoundingClientRect, getComputedStyle — right
            after you change the DOM forces the browser to recompute layout on the spot. Do it in a
            loop and you pay for N reflows instead of one. The fix never changes: batch every read,
            then every write.
          </p>
        </article>
        <article>
          <h2>2 · Expensive frames</h2>
          <p>
            Some properties are cheap to animate and some aren&apos;t. transform and opacity ride
            the compositor. top, left, width and margin re-run layout every frame; big shadows and
            blur re-paint every frame. Animate the wrong one at scale and the frame budget is gone.
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
