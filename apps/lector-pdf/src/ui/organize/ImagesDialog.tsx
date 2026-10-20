import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import type { PageSizeMode } from '../../core/pdf/images-to-pdf';
import { Dialog } from '../kit/Dialog';
import { imagesMsg } from '../messages-images';
import { organizeMsg } from '../messages-organize';
import {
  addImages,
  closeImagesDialog,
  createPdfFromImages,
  moveImage,
  removeImage,
  setImagesMargin,
  setImagesPageSize,
  useImagesDialog,
  type MarginChoice,
} from '../../state/images-pdf-actions';
import styles from './ImagesDialog.module.css';

const PAGE_SIZE_OPTIONS: readonly { readonly value: PageSizeMode; readonly label: string }[] = [
  { value: 'fit', label: imagesMsg.fit },
  { value: 'a4', label: imagesMsg.a4 },
  { value: 'letter', label: imagesMsg.letter },
];

const MARGIN_OPTIONS: readonly { readonly value: MarginChoice; readonly label: string }[] = [
  { value: 0, label: imagesMsg.none },
  { value: 18, label: imagesMsg.small },
  { value: 36, label: imagesMsg.normal },
];

/**
 * Diálogo «Crear PDF desde imágenes» (PDF-129): lista ordenada de imágenes con miniatura, subir, bajar y quitar.
 * Alt+↑/↓ mueve la imagen con foco. Lo monta `App` solo mientras está abierto.
 */
export function ImagesDialog(): ReactElement {
  const items = useImagesDialog((s) => s.items);
  const pageSize = useImagesDialog((s) => s.pageSize);
  const margin = useImagesDialog((s) => s.margin);
  const listRef = useRef<HTMLDivElement>(null);
  // Id de la imagen movida con el teclado: recupera el foco tras reordenar la lista.
  const focusAfterMove = useRef<string | null>(null);

  const ready = items.length > 0;

  useEffect(() => {
    const id = focusAfterMove.current;
    if (id === null) return;
    focusAfterMove.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-image-id="${id}"]`)?.focus();
  }, [items]);

  const moveByKeyboard = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    const target = index + delta;
    const item = items[index];
    event.preventDefault();
    if (item === undefined || target < 0 || target >= items.length) return;
    focusAfterMove.current = item.id;
    moveImage(item.id, delta);
  };

  return (
    <Dialog
      open
      title={imagesMsg.title}
      onClose={closeImagesDialog}
      actions={[
        {
          label: imagesMsg.create,
          onClick: () => {
            void createPdfFromImages();
          },
          disabled: !ready,
        },
        {
          label: imagesMsg.add,
          onClick: () => {
            void addImages();
          },
        },
        { label: organizeMsg.cancel, onClick: closeImagesDialog },
      ]}
    >
      {!ready ? <p className={styles.hint}>{imagesMsg.hint}</p> : null}
      <div className={styles.table}>
        <div role="listbox" aria-label={imagesMsg.list} aria-orientation="vertical" ref={listRef} className={styles.list}>
          {items.map((item, index) => (
            <div
              role="option"
              key={item.id}
              aria-selected={false}
              tabIndex={0}
              data-image-id={item.id}
              className={styles.option}
              onKeyDown={(event) => {
                moveByKeyboard(event, index);
              }}
            >
              <img src={item.previewUrl} alt="" className={styles.thumb} />
              <span className={styles.name}>{item.name}</span>
            </div>
          ))}
        </div>
        {/* Botones fuera de la lista (axe: una lista solo admite opciones); cada fila tiene la altura de su opción. */}
        <div className={styles.actions}>
          {items.map((item, index) => (
            <div key={item.id} className={styles.rowActions}>
              <button
                type="button"
                aria-label={`${imagesMsg.moveUp} ${item.name}`}
                disabled={index === 0}
                onClick={() => {
                  moveImage(item.id, -1);
                }}
              >
                {imagesMsg.moveUp}
              </button>
              <button
                type="button"
                aria-label={`${imagesMsg.moveDown} ${item.name}`}
                disabled={index === items.length - 1}
                onClick={() => {
                  moveImage(item.id, 1);
                }}
              >
                {imagesMsg.moveDown}
              </button>
              <button
                type="button"
                aria-label={`${imagesMsg.remove} ${item.name}`}
                onClick={() => {
                  removeImage(item.id);
                }}
              >
                {imagesMsg.remove}
              </button>
            </div>
          ))}
        </div>
      </div>
      <fieldset className={styles.group}>
        <legend>{imagesMsg.pageSize}</legend>
        {PAGE_SIZE_OPTIONS.map((option) => (
          <label key={option.value} className={styles.choice}>
            <input
              type="radio"
              name="images-page-size"
              value={option.value}
              checked={pageSize === option.value}
              onChange={() => {
                setImagesPageSize(option.value);
              }}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <fieldset className={styles.group} disabled={pageSize === 'fit'}>
        <legend>{imagesMsg.margin}</legend>
        {MARGIN_OPTIONS.map((option) => (
          <label key={option.value} className={styles.choice}>
            <input
              type="radio"
              name="images-margin"
              value={String(option.value)}
              checked={margin === option.value}
              onChange={() => {
                setImagesMargin(option.value);
              }}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}
