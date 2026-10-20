import { MenuButton, type MenuEntry } from '../kit/MenuButton';
import { IconViewMode } from '../icons';
import { viewMsg } from '../messages-view';
import { setViewMode } from '../../state/view-actions';
import { toggleFullscreen } from '../../state/fullscreen-actions';
import { services } from '../../state/services';
import { formatShortcut } from '../shortcuts';
import { useViewer } from '../../state/viewer-store';
import { loadVoices, startReading, useReadAloud } from '../../state/read-aloud-actions';
import { readAloudMsg } from '../messages-read-aloud';

/** Menú «Vista» (PDF-050): desplazamiento continuo o una página a la vez, y páginas por fila. */
export function ViewMenu() {
  const viewMode = useViewer((s) => s.viewMode);
  const ready = useViewer((s) => s.status === 'ready');
  const readUnavailable = useReadAloud((s) => s.unavailable);
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
    'separator',
    // Leer en voz alta (PDF-114): sin voces locales se ve, pero no se elige (nunca se usa una voz en red, ADR-0033).
    {
      kind: 'action',
      label: readAloudMsg.readPage,
      shortcut: formatShortcut('read-page', services().platform.isMac),
      disabled: readUnavailable,
      disabledReason: readAloudMsg.noVoices,
      onSelect: () => { void startReading('page'); },
    },
    {
      kind: 'action',
      label: readAloudMsg.readToEnd,
      shortcut: formatShortcut('read-to-end', services().platform.isMac),
      disabled: readUnavailable,
      disabledReason: readAloudMsg.noVoices,
      onSelect: () => { void startReading('document'); },
    },
  ];
  return (
    <MenuButton
      label={viewMsg.view}
      entries={entries}
      disabled={!ready}
      onOpen={() => { void loadVoices(); }}
    >
      <IconViewMode />
    </MenuButton>
  );
}
