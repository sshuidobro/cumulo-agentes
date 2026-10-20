import { useId, useMemo, type KeyboardEvent } from 'react';
import type { OcrLanguage } from '../../engine/ocr';
import { Dialog } from '../kit/Dialog';
import { printMsg } from '../messages-print';
import { ocrMsg } from '../messages-ocr';
import { closeOcrDialog, runOcr, setOcrForm, useOcrDialog } from '../../state/ocr-actions';
import { pageIndicesFor } from '../../state/print-actions';
import { useViewer } from '../../state/viewer-store';
import styles from './OcrDialog.module.css';

const LANGUAGES: readonly { readonly value: OcrLanguage; readonly label: string }[] = [
  { value: 'spa', label: ocrMsg.spa },
  { value: 'eng', label: ocrMsg.eng },
  { value: 'spa+eng', label: ocrMsg.both },
];

/** Diálogo «Reconocer texto» (PDF-134): páginas como en exportar, idioma y omitir las que ya tienen texto. */
export function OcrDialog() {
  const open = useOcrDialog((s) => s.open);
  const form = useOcrDialog((s) => s.form);
  const numPages = useViewer((s) => s.pdf?.numPages ?? 0);
  const currentPage = useViewer((s) => s.currentPage);
  const pageGroup = useId();
  const langId = useId();
  const skipId = useId();

  const indices = useMemo(
    () => pageIndicesFor(form, numPages, currentPage),
    [form, numPages, currentPage],
  );
  const valid = indices !== null && indices.length > 0;
  const rangeInvalid = form.pages === 'range' && !valid;

  // Reconocer cierra el diálogo; el progreso lo muestra DocOpJobProgress.
  const start = (): void => {
    if (!valid) return;
    const snapshot = useOcrDialog.getState().form;
    closeOcrDialog();
    void runOcr(snapshot);
  };

  // Intro en cualquier control (salvo los botones) equivale a pulsar Reconocer.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    start();
  };

  return (
    <Dialog
      open={open}
      title={ocrMsg.title}
      onClose={closeOcrDialog}
      actions={[
        { label: ocrMsg.run, onClick: start, disabled: !valid },
        { label: ocrMsg.cancel, onClick: closeOcrDialog },
      ]}
    >
      <div onKeyDown={onKeyDown}>
        <div className={styles.field}>
          <label htmlFor={langId}>{ocrMsg.language}</label>
          <select
            id={langId}
            className={styles.select}
            value={form.lang}
            data-initial-focus="true"
            onChange={(event) => {
              const lang = LANGUAGES.find((l) => l.value === event.currentTarget.value);
              if (lang !== undefined) setOcrForm({ lang: lang.value });
            }}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{printMsg.pagesLegend}</legend>
          <label className={styles.option}>
            <input
              type="radio"
              name={pageGroup}
              value="all"
              checked={form.pages === 'all'}
              onChange={() => { setOcrForm({ pages: 'all' }); }}
            />
            {printMsg.allPages}
          </label>
          <label className={styles.option}>
            <input
              type="radio"
              name={pageGroup}
              value="current"
              checked={form.pages === 'current'}
              onChange={() => { setOcrForm({ pages: 'current' }); }}
            />
            {printMsg.currentPage(currentPage + 1)}
          </label>
          <div className={styles.option}>
            <label className={styles.rangeLabel}>
              <input
                type="radio"
                name={pageGroup}
                value="range"
                checked={form.pages === 'range'}
                onChange={() => { setOcrForm({ pages: 'range' }); }}
              />
              {printMsg.rangePages}
            </label>
            <input
              type="text"
              className={styles.rangeInput}
              aria-label={printMsg.rangeField}
              placeholder={printMsg.rangeExample}
              value={form.range}
              aria-invalid={rangeInvalid}
              onChange={(event) => { setOcrForm({ pages: 'range', range: event.currentTarget.value }); }}
            />
          </div>
          {rangeInvalid ? (
            <p role="alert" className={styles.error}>
              {printMsg.invalidRange(numPages)}
            </p>
          ) : null}
        </fieldset>

        <label className={styles.option} htmlFor={skipId}>
          <input
            id={skipId}
            type="checkbox"
            checked={form.skipText}
            onChange={(event) => { setOcrForm({ skipText: event.currentTarget.checked }); }}
          />
          {ocrMsg.skipText}
        </label>

        <p className={styles.privacy}>{ocrMsg.privacy}</p>
      </div>
    </Dialog>
  );
}
