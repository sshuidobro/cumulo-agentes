import { useId, useMemo, type KeyboardEvent } from 'react';
import { Dialog } from '../kit/Dialog';
import { printMsg } from '../messages-print';
import {
  closePrintDialog,
  pageIndicesFor,
  setPrintForm,
  startPrint,
  usePrintDialog,
} from '../../state/print-actions';
import { useViewer } from '../../state/viewer-store';
import { securityMsg } from '../messages-security';
import styles from './PrintDialog.module.css';

/** Diálogo «Imprimir» (PDF-044): páginas, comentarios, orientación y calidad. Se abre con Ctrl+P. */
export function PrintDialog() {
  const open = usePrintDialog((s) => s.open);
  const form = usePrintDialog((s) => s.form);
  const numPages = useViewer((s) => s.pdf?.numPages ?? 0);
  const currentPage = useViewer((s) => s.currentPage);
  const pageGroup = useId();
  const rangeHintId = useId();
  const highQualityHintId = useId();
  // Alta calidad solo si el PDF lo permite (PDF-048); si no, se explica y se imprime a 150 ppp.
  const highQualityAllowed = useViewer((s) => s.permissions.printHighQuality);

  const indices = useMemo(
    () => pageIndicesFor(form, numPages, currentPage),
    [form, numPages, currentPage],
  );
  const valid = indices !== null && indices.length > 0;
  const rangeInvalid = form.pages === 'range' && !valid;

  // Imprimir cierra el diálogo y deja la preparación al progreso (PrintProgress).
  const start = (): void => {
    if (!valid) return;
    const snapshot = usePrintDialog.getState().form;
    closePrintDialog();
    void startPrint(snapshot);
  };

  // Intro en el campo de rango equivale a pulsar Imprimir.
  const onRangeKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    start();
  };

  return (
    <Dialog
      open={open}
      title={printMsg.title}
      onClose={closePrintDialog}
      actions={[
        { label: printMsg.print, onClick: start, disabled: !valid },
        { label: printMsg.cancel, onClick: closePrintDialog },
      ]}
    >
      <fieldset className={styles.group}>
        <legend className={styles.legend}>{printMsg.pagesLegend}</legend>
        <label className={styles.option}>
          <input
            type="radio"
            name={pageGroup}
            value="all"
            checked={form.pages === 'all'}
            onChange={() => { setPrintForm({ pages: 'all' }); }}
          />
          {printMsg.allPages}
        </label>
        <label className={styles.option}>
          <input
            type="radio"
            name={pageGroup}
            value="current"
            checked={form.pages === 'current'}
            onChange={() => { setPrintForm({ pages: 'current' }); }}
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
              onChange={() => { setPrintForm({ pages: 'range' }); }}
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
            aria-describedby={rangeInvalid ? rangeHintId : undefined}
            onChange={(event) => { setPrintForm({ pages: 'range', range: event.currentTarget.value }); }}
            onKeyDown={onRangeKeyDown}
          />
        </div>
        {rangeInvalid ? (
          <p id={rangeHintId} role="alert" className={styles.error}>
            {printMsg.invalidRange(numPages)}
          </p>
        ) : null}
      </fieldset>

      <div className={styles.checks}>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={form.withComments}
            onChange={(event) => { setPrintForm({ withComments: event.currentTarget.checked }); }}
          />
          {printMsg.withComments}
        </label>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={form.autoRotate}
            onChange={(event) => { setPrintForm({ autoRotate: event.currentTarget.checked }); }}
          />
          {printMsg.autoRotate}
        </label>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={highQualityAllowed && form.highQuality}
            disabled={!highQualityAllowed}
            aria-describedby={highQualityAllowed ? undefined : highQualityHintId}
            onChange={(event) => { setPrintForm({ highQuality: event.currentTarget.checked }); }}
          />
          {printMsg.highQuality}
        </label>
        {highQualityAllowed ? null : (
          <p id={highQualityHintId} className={styles.hint}>
            {securityMsg.highQualityBlocked}
          </p>
        )}
      </div>

      <p className={styles.count} aria-live="polite">
        {indices !== null && valid ? printMsg.willPrint(indices.length) : null}
      </p>
    </Dialog>
  );
}
