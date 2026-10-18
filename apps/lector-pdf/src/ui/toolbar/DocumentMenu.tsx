import { MenuButton } from '../kit/MenuButton';
import { IconMore } from '../icons';
import { formatShortcut } from '../shortcuts';
import { printMsg } from '../messages-print';
import { propertiesMsg } from '../messages-properties';
import { openPrintDialog } from '../../state/print-actions';
import { openProperties } from '../../state/properties-store';
import { services } from '../../state/services';
import { useViewer } from '../../state/viewer-store';

/** Menú «Más acciones» de la barra: acciones sobre el documento abierto (PDF-045). Sin documento está deshabilitado. */
export function DocumentMenu() {
  const { platform } = services();
  const ready = useViewer((s) => s.status === 'ready');
  return (
    <MenuButton
      label={propertiesMsg.moreActions}
      disabled={!ready}
      entries={[
        {
          kind: 'action',
          label: propertiesMsg.menuItem,
          shortcut: formatShortcut('properties', platform.isMac),
          onSelect: () => { openProperties(); },
        },
        {
          kind: 'action',
          label: printMsg.menuItem,
          shortcut: formatShortcut('print', platform.isMac),
          onSelect: () => { openPrintDialog(); },
        },
      ]}
    >
      <IconMore />
    </MenuButton>
  );
}
