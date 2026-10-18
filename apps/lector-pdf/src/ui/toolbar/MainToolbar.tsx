import { IconButton } from '../kit/IconButton';
import { MenuButton } from '../kit/MenuButton';
import { IconAppearance, IconHand, IconNextPage, IconOpen, IconPrevPage, IconRedo, IconRotateLeft, IconRotateRight, IconSave, IconSaveAs, IconSelect, IconSidebar, IconUndo } from '../icons';
import { msg } from '../messages';
import { formatOpenShortcut, formatShortcut } from '../shortcuts';
import { ZoomControls } from './ZoomControls';
import { PageNavigator } from './PageNavigator';
import { pickAndOpen } from '../../state/document-actions';
import { goBack, goForward } from '../../state/history';
import { redo, undo } from '../../state/annotation-actions';
import { useAnnotations } from '../../state/annotation-store';
import { save, saveAs, useSaving } from '../../state/save-actions';
import { services } from '../../state/services';
import { useAppearance } from '../../state/appearance-store';
import { setTheme, toggleNightMode } from '../../state/appearance-actions';
import { toggleSidebar } from '../../state/sidebar-actions';
import { rotateView, setViewTool } from '../../state/view-actions';
import { useViewer } from '../../state/viewer-store';
import styles from './MainToolbar.module.css';

/** Barra principal: abrir, deshacer/rehacer, zoom y giro de la vista. Lo de documento se activa con uno abierto. */
export function MainToolbar() {
  const { platform } = services();
  const ready = useViewer((s) => s.status === 'ready');
  const undoState = useAnnotations((s) => s.undo);
  const tool = useViewer((s) => s.tool);
  const history = useViewer((s) => s.historyState);
  const sidebar = useViewer((s) => s.sidebar);
  const saving = useSaving((s) => s.saving);
  const theme = useAppearance((s) => s.theme);
  const nightMode = useAppearance((s) => s.nightMode);

  return (
    <header className={styles.toolbar} role="toolbar" aria-label={msg.toolbarLabel}>
      <IconButton
        label={msg.open}
        shortcut={formatOpenShortcut(platform.isMac)}
        onClick={() => void pickAndOpen()}
      >
        <IconOpen />
      </IconButton>
      <IconButton
        label={msg.save}
        shortcut={formatShortcut('save', platform.isMac)}
        disabled={!ready || saving}
        onClick={() => { void save(); }}
      >
        <IconSave />
      </IconButton>
      <IconButton
        label={msg.saveAs}
        shortcut={formatShortcut('save-as', platform.isMac)}
        disabled={!ready || saving}
        onClick={() => { void saveAs(); }}
      >
        <IconSaveAs />
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
      <IconButton
        label={msg.sidebar}
        shortcut={formatShortcut('toggle-sidebar', platform.isMac)}
        pressed={sidebar !== 'none'}
        disabled={!ready}
        onClick={toggleSidebar}
      >
        <IconSidebar />
      </IconButton>
      <div role="separator" aria-orientation="vertical" className={styles.separator} />
      <IconButton
        label={msg.back}
        shortcut={formatShortcut('back', platform.isMac)}
        disabled={!history.canBack}
        onClick={() => { goBack(); }}
      >
        <IconPrevPage />
      </IconButton>
      <IconButton
        label={msg.forward}
        shortcut={formatShortcut('forward', platform.isMac)}
        disabled={!history.canForward}
        onClick={() => { goForward(); }}
      >
        <IconNextPage />
      </IconButton>
      <div role="separator" aria-orientation="vertical" className={styles.separator} />
      <PageNavigator />
      <div role="separator" aria-orientation="vertical" className={styles.separator} />
      <IconButton
        label={msg.toolSelect}
        shortcut={formatShortcut('tool-select', platform.isMac)}
        pressed={tool === 'select'}
        disabled={!ready}
        onClick={() => { setViewTool('select'); }}
      >
        <IconSelect />
      </IconButton>
      <IconButton
        label={msg.toolHand}
        shortcut={formatShortcut('tool-hand', platform.isMac)}
        pressed={tool === 'hand'}
        disabled={!ready}
        onClick={() => { setViewTool('hand'); }}
      >
        <IconHand />
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
      <div role="separator" aria-orientation="vertical" className={styles.separator} />
      <MenuButton
        label={msg.appearance}
        entries={[
          { kind: 'radio', label: msg.themeSystem, checked: theme === 'system', onSelect: () => { setTheme('system'); } },
          { kind: 'radio', label: msg.themeLight, checked: theme === 'light', onSelect: () => { setTheme('light'); } },
          { kind: 'radio', label: msg.themeDark, checked: theme === 'dark', onSelect: () => { setTheme('dark'); } },
          'separator',
          { kind: 'checkbox', label: msg.nightMode, checked: nightMode, onSelect: toggleNightMode },
        ]}
      >
        <IconAppearance />
      </MenuButton>
    </header>
  );
}
