import { useId, useMemo, type KeyboardEvent } from 'react';
import { EXPORT_DPIS, type ExportFormat } from '../../core/export/plan';
import { Dialog } from '../kit/Dialog';
import { exportMsg } from '../messages-export';
import {
  closeExportDialog,
  setExportForm,
  startExport,
  useExportDialog,
  type ExportOptions,
} from '../../state/export-actions';
import { pageIndicesFor } from '../../state/print-actions';
import { useViewer } from '../../state/viewer-store';
import styles from './ExportDialog.module.css';

const FORMATS: readonly { readonly value: ExportFormat; readonly label: string }[] = [
  { value: 'png', label: exportMsg.png },
  { value: 'jpeg', label: exportMsg.jpeg },
  { value: 'txt', label: exportMsg.txt },
];

/** Convierte el valor de un `<select>` en uno de `EXPORT_DPIS` (cualquier otro valor no pasa). */
function dpiFromValue(value: string, fallback: ExportOptions['dpi']): ExportOptions['dpi'] {
  const found = EXPORT_DPIS.find((dpi) => String(dpi) === value);
  return found ?? fallback;
}

/** Diálogo «Exportar» (PDF-113): formato, resolución y comentarios para imágenes, y páginas como en imprimir. */
export function ExportDialog() {
  const open = useExportDialog((s) => s.open);
  const form = useExportDialog((s) => s.form);
  const numPages = useViewer((s) => s.pdf?.numPages ?? 0);
  const currentPage = useViewer((s) => s.currentPage);
  const formatGroup = useId();
  const pageGroup = useId();
  const dpiId = useId();

  const indices = useMemo(
    () => pageIndicesFor(form, numPages, currentPage),
    [form, numPages, currentPage],
  );
  const valid = indices !== null && indices.length > 0;
  const rangeInvalid = form.pages === 'range' && !valid;
  const imageFormat = form.format !== 'txt';

  // Exportar cierra el diálogo y deja el progreso a ExportProgress.
  const start = (): void => {
    if (!valid) return;
    const snapshot = useExportDialog.getState().form;
    closeExportDialog();
    void startExport(snapshot);
  };

  // Intro en cualquier control (salvo los botones) equivale a pulsar Exportar.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    start();
  };

  return (
    <Dialog
      open={open}
      title={exportMsg.title}
      onClose={closeExportDialog}
      actions={[
        { label: exportMsg.export, onClick: start, disabled: !valid },
        { label: exportMsg.cancel, onClick: closeExportDialog },
      ]}
    >
      <div onKeyDown={onKeyDown}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{exportMsg.formatLegend}</legend>
          {FORMATS.map((format, index) => (
            <label key={format.value} className={styles.option}>
              <input
                type="radio"
                name={formatGroup}
                value={format.value}
                checked={form.format === format.value}
                data-initial-focus={index === 0 ? 'true' : undefined}
                onChange={() => { setExportForm({ format: format.value }); }}
              />
              {format.label}
            </label>
          ))}
        </fieldset>

        {imageFormat ? (
          <div className={styles.checks}>
            <div className={styles.resolution}>
              <label htmlFor={dpiId}>{exportMsg.resolution}</label>
              <select
                id={dpiId}
                className={styles.select}
                value={String(form.dpi)}
                onChange={(event) => { setExportForm({ dpi: dpiFromValue(event.currentTarget.value, form.dpi) }); }}
              >
                {EXPORT_DPIS.map((dpi) => (
                  <option key={dpi} value={String(dpi)}>
                    {exportMsg.dpiOption(dpi)}
                  </option>
                ))}
              </select>
            </div>
            <label className={styles.option}>
              <input
                type="checkbox"
                checked={form.withComments}
                onChange={(event) => { setExportForm({ withComments: event.currentTarget.checked }); }}
              />
              {exportMsg.withComments}
            </label>
          </div>
        ) : null}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{exportMsg.pagesLegend}</legend>
          <label className={styles.option}>
            <input
              type="radio"
              name={pageGroup}
              value="all"
              checked={form.pages === 'all'}
              onChange={() => { setExportForm({ pages: 'all' }); }}
            />
            {exportMsg.allPages}
          </label>
          <label className={styles.option}>
            <input
              type="radio"
              name={pageGroup}
              value="current"
              checked={form.pages === 'current'}
              onChange={() => { setExportForm({ pages: 'current' }); }}
            />
            {exportMsg.currentPage(currentPage + 1)}
          </label>
          <div className={styles.option}>
            <label className={styles.rangeLabel}>
              <input
                type="radio"
                name={pageGroup}
                value="range"
                checked={form.pages === 'range'}
                onChange={() => { setExportForm({ pages: 'range' }); }}
              />
              {exportMsg.rangePages}
            </label>
            <input
              type="text"
              className={styles.rangeInput}
              aria-label={exportMsg.rangeField}
              placeholder={exportMsg.rangeExample}
              value={form.range}
              aria-invalid={rangeInvalid}
              onChange={(event) => { setExportForm({ pages: 'range', range: event.currentTarget.value }); }}
            />
          </div>
          {rangeInvalid ? (
            <p role="alert" className={styles.error}>
              {exportMsg.invalidRange(numPages)}
            </p>
          ) : null}
        </fieldset>
      </div>
    </Dialog>
  );
}
