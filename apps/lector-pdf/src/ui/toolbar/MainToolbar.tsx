import { IconButton } from '../kit/IconButton';
import { IconOpen, IconRedo, IconRotateLeft, IconRotateRight, IconUndo } from '../icons';
import { msg } from '../messages';
import { formatOpenShortcut, formatShortcut } from '../shortcuts';
import { ZoomControls } from './ZoomControls';
import { pickAndOpen } from '../../state/document-actions';
import { redo, undo } from '../../state/annotation-actions';
import { useAnnotations } from '../../state/annotation-store';
import { services } from '../../state/services';
import { rotateView } from '../../state/view-actions';
import { useViewer } from '../../state/viewer-store';
import styles from './MainToolbar.module.css';

/** Barra principal: abrir, deshacer/rehacer, zoom y giro de la vista. Lo de documento se activa con uno abierto. */
export function MainToolbar() {
  const { platform } = services();
  const ready = useViewer((s) => s.status === 'ready');
  const undoState = useAnnotations((s) => s.undo);

  return (
    <header className={styles.toolbar} role="toolbar" aria-label={msg.toolbarLabel}>
      <IconButton
        label={msg.open}
        shortcut={formatOpenShortcut(platform.isMac)}
        onClick={() => void pickAndOpen()}
      >
        <IconOpen />
      </IconButton>
      <div role="separator" aria-orientation="vertical" className={styles.separator} />
      <IconButton
        label={undoState.undoLabel === null ? msg.undo : msg.undoWith(undoState.undoLabel)}
        shortcut={formatShortcut('undo', platform.isMac)}
        disabled={!undoState.canUndo}
        onClick={undo}
      >
        <IconUndo />
      </IconButton>
      <IconButton
        label={undoState.redoLabel === null ? msg.redo : msg.redoWith(undoState.redoLabel)}
        shortcut={formatShortcut('redo', platform.isMac)}
        disabled={!undoState.canRedo}
        onClick={redo}
      >
        <IconRedo />
      </IconButton>
      <div role="separator" aria-orientation="vertical" className={styles.separator} />
      <ZoomControls />
      <div role="separator" aria-orientation="vertical" className={styles.separator} />
      <IconButton
        label={msg.rotateLeft}
        shortcut={formatShortcut('rotate-left', platform.isMac)}
        disabled={!ready}
        onClick={() => { rotateView(-1); }}
      >
        <IconRotateLeft />
      </IconButton>
      <IconButton
        label={msg.rotateRight}
        shortcut={formatShortcut('rotate-right', platform.isMac)}
        disabled={!ready}
        onClick={() => { rotateView(1); }}
      >
        <IconRotateRight />
      </IconButton>
    </header>
  );
}
