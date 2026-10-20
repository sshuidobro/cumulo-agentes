import type { ChangeEvent, ReactElement } from 'react';
import { IconButton } from '../kit/IconButton';
import { MenuButton } from '../kit/MenuButton';
import { IconInsertPage, IconRedo, IconRotateLeft, IconRotateRight, IconTrash, IconUndo } from '../icons';
import { formatShortcut } from '../shortcuts';
import { organizeMsg } from '../messages-organize';
import { services } from '../../state/services';
import {
  closeOrganize,
  deleteSelected,
  insertBlank,
  organizeRedo,
  organizeUndo,
  rotateSelected,
  saveOrganize,
} from '../../state/organize-actions';
import { useOrganize } from '../../state/organize-store';
import { ORGANIZE_CELL_SIZES } from '../../core/organize/grid';
import styles from './OrganizeView.module.css';

export interface OrganizeToolbarProps {
  readonly cellSize: number;
  readonly onCellSize: (size: number) => void;
}

/** Barra de la vista «Organizar páginas» (PDF-125): giros, borrado, inserción, deshacer, tamaño, guardar y cerrar. */
export function OrganizeToolbar({ cellSize, onCellSize }: OrganizeToolbarProps): ReactElement {
  const { platform } = services();
  const isMac = platform.isMac;
  const status = useOrganize((s) => s.status);
  const plan = useOrganize((s) => s.plan);
  const selected = useOrganize((s) => s.selection.keys.size);
  const undo = useOrganize((s) => s.undo);
  const ready = status === 'ready';
  const hasSelection = selected > 0;

  const undoName = undo.undoLabel === null ? organizeMsg.undo : organizeMsg.undoLabel(undo.undoLabel);
  const redoName = undo.redoLabel === null ? organizeMsg.redo : organizeMsg.redoLabel(undo.redoLabel);

  return (
    <div role="toolbar" aria-label={organizeMsg.toolbar} className={styles.toolbar}>
      <IconButton
        label={organizeMsg.rotateLeft}
        shortcut={formatShortcut('organize-rotate-left', isMac)}
        disabled={!ready || !hasSelection}
        onClick={() => {
          rotateSelected(-90);
        }}
      >
        <IconRotateLeft />
      </IconButton>
      <IconButton
        label={organizeMsg.rotateRight}
        shortcut={formatShortcut('organize-rotate-right', isMac)}
        disabled={!ready || !hasSelection}
        onClick={() => {
          rotateSelected(90);
        }}
      >
        <IconRotateRight />
      </IconButton>
      <IconButton
        label={organizeMsg.delete}
        shortcut={formatShortcut('organize-delete', isMac)}
        disabled={!ready || !hasSelection}
        onClick={() => {
          deleteSelected();
        }}
      >
        <IconTrash />
      </IconButton>
      <MenuButton
        label={organizeMsg.insertBlank}
        disabled={!ready}
        entries={[
          {
            kind: 'action',
            label: organizeMsg.before,
            onSelect: () => {
              insertBlank('before');
            },
          },
          {
            kind: 'action',
            label: organizeMsg.after,
            onSelect: () => {
              insertBlank('after');
            },
          },
        ]}
      >
        <IconInsertPage />
      </MenuButton>
      <IconButton
        label={undoName}
        shortcut={formatShortcut('undo', isMac)}
        disabled={!ready || !undo.canUndo}
        onClick={() => {
          organizeUndo();
        }}
      >
        <IconUndo />
      </IconButton>
      <IconButton
        label={redoName}
        shortcut={formatShortcut('redo', isMac)}
        disabled={!ready || !undo.canRedo}
        onClick={() => {
          organizeRedo();
        }}
      >
        <IconRedo />
      </IconButton>
      <select
        aria-label={organizeMsg.thumbSize}
        className={styles.sizeSelect}
        value={cellSize}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onCellSize(Number(event.currentTarget.value));
        }}
      >
        {ORGANIZE_CELL_SIZES.map((size) => (
          <option key={size} value={size}>
            {organizeMsg.cellSize(size)}
          </option>
        ))}
      </select>
      <span className={styles.count} aria-live="polite">
        {organizeMsg.count(plan.slots.length, selected)}
      </span>
      <span className={styles.grow} />
      <button
        type="button"
        className={styles.primary}
        disabled={!ready}
        onClick={() => {
          void saveOrganize();
        }}
      >
        {organizeMsg.save}
      </button>
      <button
        type="button"
        onClick={() => {
          void closeOrganize();
        }}
      >
        {organizeMsg.close}
      </button>
    </div>
  );
}
