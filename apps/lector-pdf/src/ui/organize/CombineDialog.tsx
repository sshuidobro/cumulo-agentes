import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { Dialog } from '../kit/Dialog';
import { organizeMsg } from '../messages-organize';
import {
  addCombineFiles,
  closeCombineDialog,
  combineFiles,
  moveCombineItem,
  removeCombineItem,
  useCombineDialog,
} from '../../state/combine-actions';
import { useViewer } from '../../state/viewer-store';
import { useEncryptedDocument } from './ExtractDialog';
import styles from './CombineDialog.module.css';

/**
 * Diálogo «Combinar archivos» (PDF-128): lista ordenada de PDF con subir, bajar y quitar. Alt+↑/↓ mueve el elemento con
 * foco. Lo monta `App` solo mientras está abierto.
 */
export function CombineDialog(): ReactElement {
  const items = useCombineDialog((s) => s.items);
  const file = useViewer((s) => s.file);
  const currentEncrypted = useEncryptedDocument(file);
  const listRef = useRef<HTMLDivElement>(null);
  // Id del elemento movido con el teclado: recupera el foco tras reordenar la lista.
  const focusAfterMove = useRef<string | null>(null);

  const ready = items.length >= 2;
  const anyProtected = items.some((item) => (item.source === 'current' ? currentEncrypted : item.source.password !== null));

  useEffect(() => {
    const id = focusAfterMove.current;
    if (id === null) return;
    focusAfterMove.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-combine-id="${id}"]`)?.focus();
  }, [items]);

  const moveByKeyboard = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    const target = index + delta;
    const item = items[index];
    event.preventDefault();
    if (item === undefined || target < 0 || target >= items.length) return;
    focusAfterMove.current = item.id;
    moveCombineItem(item.id, delta);
  };

  return (
    <Dialog
      open
      title={organizeMsg.combineTitle}
      onClose={closeCombineDialog}
      actions={[
        {
          label: organizeMsg.combineAction,
          onClick: () => {
            void combineFiles();
          },
          disabled: !ready,
        },
        {
          label: organizeMsg.addFiles,
          onClick: () => {
            void addCombineFiles();
          },
        },
        { label: organizeMsg.cancel, onClick: closeCombineDialog },
      ]}
    >
      {!ready ? <p className={styles.hint}>{organizeMsg.combineHint}</p> : null}
      <div className={styles.table}>
        <div role="listbox" aria-label={organizeMsg.combineTitle} aria-orientation="vertical" ref={listRef} className={styles.list}>
          {items.map((item, index) => (
            <div
              role="option"
              key={item.id}
              aria-selected={false}
              tabIndex={0}
              data-combine-id={item.id}
              className={styles.option}
              onKeyDown={(event) => {
                moveByKeyboard(event, index);
              }}
            >
              <span className={styles.name}>{item.name}</span>
              <span className={styles.pages}>{organizeMsg.pagesOf(item.pages)}</span>
            </div>
          ))}
        </div>
        {/* Botones fuera de la lista (axe: una lista solo admite opciones); cada fila tiene la altura de su opción. */}
        <div className={styles.actions}>
          {items.map((item, index) => (
            <div key={item.id} className={styles.rowActions}>
              <button
                type="button"
                aria-label={`${organizeMsg.moveUp} ${item.name}`}
                disabled={index === 0}
                onClick={() => {
                  moveCombineItem(item.id, -1);
                }}
              >
                {organizeMsg.moveUp}
              </button>
              <button
                type="button"
                aria-label={`${organizeMsg.moveDown} ${item.name}`}
                disabled={index === items.length - 1}
                onClick={() => {
                  moveCombineItem(item.id, 1);
                }}
              >
                {organizeMsg.moveDown}
              </button>
              <button
                type="button"
                aria-label={`${organizeMsg.remove} ${item.name}`}
                onClick={() => {
                  removeCombineItem(item.id);
                }}
              >
                {organizeMsg.remove}
              </button>
            </div>
          ))}
        </div>
      </div>
      {anyProtected ? <p className={styles.hint}>{organizeMsg.newIsUnprotected}</p> : null}
    </Dialog>
  );
}
