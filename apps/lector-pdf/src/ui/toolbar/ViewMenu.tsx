import { MenuButton, type MenuEntry } from '../kit/MenuButton';
import { IconViewMode } from '../icons';
import { viewMsg } from '../messages-view';
import { setViewMode } from '../../state/view-actions';
import { toggleFullscreen } from '../../state/fullscreen-actions';
import { services } from '../../state/services';
import { formatShortcut } from '../shortcuts';
import { useViewer } from '../../state/viewer-store';

/** Menú «Vista» (PDF-050): desplazamiento continuo o una página a la vez, y páginas por fila. */
export function ViewMenu() {
  const viewMode = useViewer((s) => s.viewMode);
  const ready = useViewer((s) => s.status === 'ready');
  const entries: MenuEntry[] = [
    {
      kind: 'radio',
      label: viewMsg.continuous,
      checked: viewMode.scroll === 'continuous',
      onSelect: () => { setViewMode({ ...viewMode, scroll: 'continuous' }); },
    },
    {
      kind: 'radio',
      label: viewMsg.paged,
      checked: viewMode.scroll === 'paged',
      onSelect: () => { setViewMode({ ...viewMode, scroll: 'paged' }); },
    },
    'separator',
    {
      kind: 'radio',
      label: viewMsg.spreadNone,
      checked: viewMode.spread === 'none',
      onSelect: () => { setViewMode({ ...viewMode, spread: 'none' }); },
    },
    {
      kind: 'radio',
      label: viewMsg.spreadPairs,
      checked: viewMode.spread === 'pairs',
      onSelect: () => { setViewMode({ ...viewMode, spread: 'pairs' }); },
    },
    {
      kind: 'radio',
      label: viewMsg.spreadCover,
      checked: viewMode.spread === 'cover',
      onSelect: () => { setViewMode({ ...viewMode, spread: 'cover' }); },
    },
    'separator',
    {
      kind: 'action',
      label: viewMsg.fullscreen,
      shortcut: formatShortcut('fullscreen', services().platform.isMac),
      onSelect: () => { toggleFullscreen(); },
    },
  ];
  return (
    <MenuButton label={viewMsg.view} entries={entries} disabled={!ready}>
      <IconViewMode />
    </MenuButton>
  );
}
