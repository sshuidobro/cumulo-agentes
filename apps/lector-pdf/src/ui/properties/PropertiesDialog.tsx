import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { OpenedFile } from '@suite/platform';
import { readDocumentProperties, type LoadedPdf } from '../../engine';
import { formatFileSize, formatPageSize, type DocumentProperties } from '../../core/properties';
import { Dialog } from '../kit/Dialog';
import { propertiesMsg } from '../messages-properties';
import { closeProperties, usePropertiesDialog } from '../../state/properties-store';
import { useViewer } from '../../state/viewer-store';
import styles from './PropertiesDialog.module.css';

type TabId = 'description' | 'advanced';

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'description', label: propertiesMsg.tabDescription },
  { id: 'advanced', label: propertiesMsg.tabAdvanced },
];

/** Formato de fechas del diálogo: día, mes y año en español, con la hora local. */
const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' });

function orEmpty(value: string): string {
  return value === '' ? propertiesMsg.empty : value;
}

function yesNo(value: boolean): string {
  return value ? propertiesMsg.yes : propertiesMsg.no;
}

function formatDate(iso: string | null): string {
  if (iso === null) return propertiesMsg.empty;
  return dateFormat.format(new Date(iso));
}

/** Filas (etiqueta, valor) de cada pestaña. Los valores vacíos se muestran como «—». */
function rowsFor(tab: TabId, p: DocumentProperties): readonly (readonly [string, string])[] {
  const rows = propertiesMsg.rows;
  if (tab === 'description') {
    return [
      [rows.file, orEmpty(p.fileName)],
      [rows.path, orEmpty(p.path ?? '')],
      [rows.title, orEmpty(p.title)],
      [rows.author, orEmpty(p.author)],
      [rows.subject, orEmpty(p.subject)],
      [rows.keywords, orEmpty(p.keywords)],
      [rows.created, formatDate(p.created)],
      [rows.modified, formatDate(p.modified)],
      [rows.creator, orEmpty(p.creator)],
      [rows.producer, orEmpty(p.producer)],
    ];
  }
  return [
    [rows.pdfVersion, orEmpty(p.pdfVersion)],
    [rows.pageCount, p.pageCount.toLocaleString('es-ES')],
    [rows.pageSize, formatPageSize(p.pageSize.widthPt, p.pageSize.heightPt)],
    [rows.fileSize, formatFileSize(p.fileSize)],
    [rows.tagged, p.tagged === null ? propertiesMsg.unknown : yesNo(p.tagged)],
    [rows.fastWebView, yesNo(p.fastWebView)],
    [rows.encrypted, yesNo(p.encrypted)],
    [rows.hasForm, yesNo(p.hasForm)],
  ];
}

/** Lee las propiedades al abrir el diálogo. Mientras tanto muestra «Leyendo propiedades…». */
function PropertiesContent({ pdf, file, pageIndex }: { readonly pdf: LoadedPdf; readonly file: OpenedFile; readonly pageIndex: number }) {
  const [tab, setTab] = useState<TabId>('description');
  const [props, setProps] = useState<DocumentProperties | null>(null);
  const baseId = useId();

  useEffect(() => {
    let cancelled = false;
    void readDocumentProperties(pdf.doc, { fileName: file.name, path: file.path, fileSize: file.size }, pageIndex).then(
      (result) => {
        if (!cancelled) setProps(result);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pdf, file, pageIndex]);

  // ←/→ cambian de pestaña (patrón ARIA: tabs con foco itinerante); Inicio y Fin van a la primera y la última.
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = TABS.findIndex((t) => t.id === tab);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const target = TABS[next];
    if (target === undefined) return;
    setTab(target.id);
    document.getElementById(`${baseId}-tab-${target.id}`)?.focus();
  };

  let body: ReactNode;
  if (props === null) {
    body = <p className={styles.reading}>{propertiesMsg.reading}</p>;
  } else {
    body = (
      <dl className={styles.list}>
        {rowsFor(tab, props).map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt className={styles.term}>{label}</dt>
            <dd className={styles.value}>{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className={styles.content}>
      <div role="tablist" aria-label={propertiesMsg.tabsLabel} className={styles.tabs} onKeyDown={onTabKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`${baseId}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            className={styles.tab}
            onClick={() => { setTab(t.id); }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} tabIndex={0} className={styles.panel}>
        {body}
      </div>
    </div>
  );
}

/** Diálogo «Propiedades del documento» (Ctrl+D; PDF-045). Solo existe con un documento abierto. */
export function PropertiesDialog() {
  const open = usePropertiesDialog((s) => s.open);
  const pdf = useViewer((s) => s.pdf);
  const file = useViewer((s) => s.file);
  const pageIndex = useViewer((s) => s.currentPage);

  if (!open || pdf === null || file === null) return null;
  return (
    <Dialog
      open
      title={propertiesMsg.title}
      actions={[{ label: propertiesMsg.close, onClick: closeProperties }]}
      onClose={closeProperties}
    >
      <PropertiesContent pdf={pdf} file={file} pageIndex={pageIndex} />
    </Dialog>
  );
}
