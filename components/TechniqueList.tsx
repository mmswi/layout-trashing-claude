import { memo } from "react";
import type { Technique, TechniqueId } from "@/lib/techniques";
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
              <span className={styles.stage} data-stage={technique.stage}>
                {technique.stage}
              </span>
            </label>
            <details className={styles.details}>
              <summary className={styles.summary}>{technique.summary}</summary>
              <p className={styles.note}>
                <strong>Why it&apos;s slow.</strong> {technique.whySlow}
              </p>
              <p className={styles.note}>
                <strong>The fix.</strong> {technique.theFix}
              </p>
              <pre className={styles.snippet}>
                <code>{technique.badSnippet}</code>
              </pre>
            </details>
          </li>
        );
      })}
    </ul>
  );
};

export const TechniqueList = memo(TechniqueListComponent);
