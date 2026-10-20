import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import type { OpenedFile } from "@suite/platform";
import { exportBaseName } from "../../core/export/plan";
import { parsePageRange } from "../../core/print/range";
import { extractFileName } from "../../core/organize/split";
import { readCipher } from "../../engine";
import { Dialog } from "../kit/Dialog";
import { organizeMsg } from "../messages-organize";
import { printMsg } from "../messages-print";
import {
  closeExtractDialogs,
  extractPages,
  setExtractForm,
  useExtractDialog,
} from "../../state/extract-actions";
import { currentPassword } from "../../state/document-actions";
import { useViewer } from "../../state/viewer-store";
import styles from "./ExtractDialog.module.css";

/**
 * `true` si el documento actual está cifrado (el PDF nuevo no lo estará). Lee el cifrado una vez por documento.
 * Mientras se lee, o si no se puede leer, es `false`.
 */
export function useEncryptedDocument(file: OpenedFile | null): boolean {
  const [encrypted, setEncrypted] = useState(false);
  useEffect(() => {
    if (file === null) return;
    let cancelled = false;
    void readCipher(file.source, currentPassword() ?? "").then((kind) => {
      if (!cancelled) setEncrypted(kind !== null && kind !== "none");
    });
    return () => {
      cancelled = true;
    };
  }, [file]);
  return encrypted;
}

/** Diálogo «Extraer páginas» (PDF-127): página actual o un rango, y el nombre que se propondrá. Lo monta `App`. */
export function ExtractDialog() {
  const form = useExtractDialog((s) => s.extract);
  const file = useViewer((s) => s.file);
  const numPages = useViewer((s) => s.pdf?.numPages ?? 0);
  const currentPage = useViewer((s) => s.currentPage);
  const encrypted = useEncryptedDocument(file);
  const groupId = useId();

  const pages = useMemo<readonly number[] | null>(() => {
    if (form.pages === "current")
      return currentPage >= 0 && currentPage < numPages ? [currentPage] : null;
    return parsePageRange(form.range, numPages);
  }, [form.pages, form.range, currentPage, numPages]);
  const valid = pages !== null && pages.length > 0;
  const rangeInvalid = form.pages === "range" && !valid;
  const name =
    file !== null && pages !== null && valid
      ? extractFileName(exportBaseName(file.name), pages)
      : null;

  // Extraer cierra el diálogo y deja el progreso a DocOpJobProgress.
  const start = (): void => {
    if (pages === null || !valid) return;
    closeExtractDialogs();
    void extractPages(pages);
  };

  // Intro en cualquier control (salvo los botones) equivale a pulsar Extraer.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" || event.target instanceof HTMLButtonElement)
      return;
    event.preventDefault();
    start();
  };

  return (
    <Dialog
      open
      title={organizeMsg.extractTitle}
      onClose={closeExtractDialogs}
      actions={[
        { label: organizeMsg.extract, onClick: start, disabled: !valid },
        { label: organizeMsg.cancel, onClick: closeExtractDialogs },
      ]}
    >
      <div onKeyDown={onKeyDown}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{organizeMsg.extractTitle}</legend>
          <label className={styles.option}>
            <input
              type="radio"
              name={groupId}
              value="current"
              checked={form.pages === "current"}
              data-initial-focus="true"
              onChange={() => {
                setExtractForm({ pages: "current" });
              }}
            />
            {organizeMsg.extractCurrent(currentPage + 1)}
          </label>
          <div className={styles.inline}>
            <label className={styles.option}>
              <input
                type="radio"
                name={groupId}
                value="range"
                checked={form.pages === "range"}
                onChange={() => {
                  setExtractForm({ pages: "range" });
                }}
              />
              {organizeMsg.extractRange}
            </label>
            <input
              type="text"
              className={styles.field}
              aria-label={organizeMsg.extractRangeField}
              placeholder={organizeMsg.extractRangeExample}
              value={form.range}
              aria-invalid={rangeInvalid}
              onChange={(event) => {
                setExtractForm({
                  pages: "range",
                  range: event.currentTarget.value,
                });
              }}
            />
          </div>
          {rangeInvalid ? (
            <p role="alert" className={styles.error}>
              {printMsg.invalidRange(numPages)}
            </p>
          ) : null}
        </fieldset>
        {name !== null ? (
          <p className={styles.hint}>{organizeMsg.willSave(name)}</p>
        ) : null}
        {encrypted ? (
          <p className={styles.hint}>{organizeMsg.newIsUnprotected}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
