import { memo } from "react";
import { TECHNIQUE_KIND, type Technique, type TechniqueId } from "@/lib/techniques";
import styles from "./TechniqueList.module.css";

type Props = {
  techniques: Technique[];
  enabledIds: ReadonlySet<TechniqueId>;
  onToggle: (id: TechniqueId) => void;
};

const TechniqueListComponent = ({ techniques, enabledIds, onToggle }: Props) => {
  return (
    <ul className={styles.list}>
      {techniques.map((technique) => {
        const isEnabled = enabledIds.has(technique.id);
        const isHealthyControl = technique.kind === TECHNIQUE_KIND.healthyControl;
        return (
          <li key={technique.id} className={styles.item} data-enabled={isEnabled}>
            <label className={styles.row}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={isEnabled}
                onChange={() => onToggle(technique.id)}
              />
              <span className={styles.label}>{technique.label}</span>
              {isHealthyControl ? <span className={styles.kind}>control</span> : null}
              <span className={styles.stage} data-stage={technique.stage}>
                {technique.stage}
              </span>
            </label>
            <details className={styles.details}>
              <summary className={styles.summary}>{technique.summary}</summary>
              {technique.kind === TECHNIQUE_KIND.antiPattern ? (
                <>
                  <p className={styles.note}>
                    <strong>Why it&apos;s slow.</strong> {technique.whySlow}
                  </p>
                  <p className={styles.note}>
                    <strong>The fix.</strong> {technique.theFix}
                  </p>
                  <pre className={styles.snippet}>
                    <code>{technique.badSnippet}</code>
                  </pre>
                </>
              ) : (
                <>
                  <p className={styles.note}>
                    <strong>Why it&apos;s cheap.</strong> {technique.whyCheap}
                  </p>
                  <p className={styles.note}>
                    <strong>The lesson.</strong> {technique.theLesson}
                  </p>
                  <pre className={styles.snippet}>
                    <code>{technique.goodSnippet}</code>
                  </pre>
                </>
              )}
            </details>
          </li>
        );
      })}
    </ul>
  );
};

export const TechniqueList = memo(TechniqueListComponent);
