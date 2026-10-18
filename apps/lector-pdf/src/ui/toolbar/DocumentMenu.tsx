import { MenuButton } from '../kit/MenuButton';
import { IconMore } from '../icons';
import { formatShortcut } from '../shortcuts';
import { propertiesMsg } from '../messages-properties';
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
      ]}
    >
      <IconMore />
    </MenuButton>
  );
}
