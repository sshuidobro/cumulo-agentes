import { Dialog } from "./Dialog";
import { organizeMsg } from "../messages-organize";
import { cancelDocOp, useDocOpJob } from "../../state/extract-actions";
import styles from "./DocOpProgress.module.css";

export interface DocOpProgressProps {
  /** Título de la operación («Extraer páginas», «Dividir documento»…). */
  readonly label: string;
  readonly done: number;
  readonly total: number;
  readonly onCancel: () => void;
}

/** Progreso genérico de una operación de documento, con Cancelar (PDF-127). */
export function DocOpProgress({
  label,
  done,
  total,
  onCancel,
}: DocOpProgressProps) {
  const max = total > 0 ? total : 1;
  return (
    <Dialog
      open
      title={label}
      onClose={onCancel}
      actions={[{ label: organizeMsg.cancel, onClick: onCancel }]}
    >
      <div
        role="progressbar"
        aria-label={organizeMsg.progressLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(done, max)}
        className={styles.bar}
      >
        <span
          className={styles.fill}
          style={{ width: `${String((Math.min(done, max) / max) * 100)}%` }}
        />
      </div>
      <p className={styles.count}>
        {organizeMsg.progressExtract(Math.min(done + 1, max), max)}
      </p>
    </Dialog>
  );
}

/** Conecta `DocOpProgress` con la operación en curso: no se pinta si no hay ninguna. */
export function DocOpJobProgress() {
  const label = useDocOpJob((s) => s.label);
  const done = useDocOpJob((s) => s.done);
  const total = useDocOpJob((s) => s.total);
  if (label === null) return null;
  return (
    <DocOpProgress
      label={label}
      done={done}
      total={total}
      onCancel={cancelDocOp}
    />
  );
}
