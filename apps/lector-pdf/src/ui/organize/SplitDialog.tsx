import { useId, type KeyboardEvent } from "react";
import { SPLIT_SIZES_MB } from "../../core/organize/split";
import { Dialog } from "../kit/Dialog";
import { organizeMsg } from "../messages-organize";
import {
  closeExtractDialogs,
  setSplitForm,
  splitDocument,
  useExtractDialog,
  type SplitForm,
} from "../../state/extract-actions";
import { useViewer } from "../../state/viewer-store";
import { useEncryptedDocument } from "./ExtractDialog";
import styles from "./ExtractDialog.module.css";

/** Entero de un campo de texto; lo que no es un número cuenta como 0 (no válido). */
function intFromValue(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Diálogo «Dividir documento» (PDF-127): cada N páginas, por marcadores de primer nivel o por tamaño máximo. */
export function SplitDialog() {
  const form = useExtractDialog((s) => s.split);
  const file = useViewer((s) => s.file);
  const numPages = useViewer((s) => s.pdf?.numPages ?? 0);
  const outline = useViewer((s) => s.outline);
  const encrypted = useEncryptedDocument(file);
  const groupId = useId();
  const hasBookmarks = outline !== null && outline.length > 0;

  const everyValid =
    form.mode !== "pages" ||
    (Number.isInteger(form.every) && form.every >= 1 && form.every <= numPages);
  const valid = form.mode === "bookmarks" ? hasBookmarks : everyValid;
  const files =
    form.mode === "pages" && everyValid
      ? Math.ceil(numPages / form.every)
      : null;

  const select = (next: SplitForm): void => {
    setSplitForm(next);
  };

  // Dividir cierra el diálogo y deja el progreso a DocOpJobProgress.
  const start = (): void => {
    if (!valid) return;
    closeExtractDialogs();
    void splitDocument(form);
  };

  // Intro en cualquier control (salvo los botones) equivale a pulsar Dividir.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" || event.target instanceof HTMLButtonElement)
      return;
    event.preventDefault();
    start();
  };

  return (
    <Dialog
      open
      title={organizeMsg.splitTitle}
      onClose={closeExtractDialogs}
      actions={[
        { label: organizeMsg.split, onClick: start, disabled: !valid },
        { label: organizeMsg.cancel, onClick: closeExtractDialogs },
      ]}
    >
      <div onKeyDown={onKeyDown}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{organizeMsg.splitLegend}</legend>
          <div className={styles.inline}>
            <label className={styles.option}>
              <input
                type="radio"
                name={groupId}
                value="pages"
                checked={form.mode === "pages"}
                data-initial-focus="true"
                onChange={() => {
                  select({
                    mode: "pages",
                    every: form.mode === "pages" ? form.every : 1,
                  });
                }}
              />
              {organizeMsg.everyPages}
            </label>
            <input
              type="number"
              className={styles.field}
              min={1}
              max={Math.max(1, numPages)}
              step={1}
              aria-label={organizeMsg.everyPagesField}
              aria-invalid={!everyValid}
              disabled={form.mode !== "pages"}
              value={form.mode === "pages" ? form.every : 1}
              onChange={(event) => {
                select({
                  mode: "pages",
                  every: intFromValue(event.currentTarget.value),
                });
              }}
            />
            <span>{organizeMsg.everyPagesSuffix}</span>
          </div>
          <label className={styles.option}>
            <input
              type="radio"
              name={groupId}
              value="bookmarks"
              checked={form.mode === "bookmarks"}
              disabled={!hasBookmarks}
              onChange={() => {
                select({ mode: "bookmarks" });
              }}
            />
            {organizeMsg.byBookmarks}
          </label>
          {!hasBookmarks ? (
            <p className={styles.hint}>{organizeMsg.noBookmarks}</p>
          ) : null}
          <div className={styles.inline}>
            <label className={styles.option}>
              <input
                type="radio"
                name={groupId}
                value="size"
                checked={form.mode === "size"}
                onChange={() => {
                  select({ mode: "size", mb: 10 });
                }}
              />
              {organizeMsg.bySize}
            </label>
            <select
              className={styles.field}
              aria-label={organizeMsg.sizeField}
              disabled={form.mode !== "size"}
              value={form.mode === "size" ? form.mb : 10}
              onChange={(event) => {
                const mb =
                  SPLIT_SIZES_MB.find(
                    (size) => String(size) === event.currentTarget.value,
                  ) ?? 10;
                select({ mode: "size", mb });
              }}
            >
              {SPLIT_SIZES_MB.map((mb) => (
                <option key={mb} value={String(mb)}>
                  {organizeMsg.sizeOption(mb)}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        {files !== null ? (
          <p className={styles.hint}>{organizeMsg.filesToCreate(files)}</p>
        ) : null}
        {encrypted ? (
          <p className={styles.hint}>{organizeMsg.newIsUnprotected}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
