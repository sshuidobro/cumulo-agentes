import { MenuButton } from '../kit/MenuButton';
import { IconMore } from '../icons';
import { formatShortcut } from '../shortcuts';
import { printMsg } from '../messages-print';
import { exportMsg } from '../messages-export';
import { propertiesMsg } from '../messages-properties';
import { compareMsg } from '../messages-compare';
import { organizeMsg } from '../messages-organize';
import { openPrintDialog } from '../../state/print-actions';
import { openExportDialog } from '../../state/export-actions';
import { startCompare } from '../../state/compare-actions';
import { openOrganize } from '../../state/organize-actions';
import { openExtractDialog, openSplitDialog } from '../../state/extract-actions';
import { openProperties } from '../../state/properties-store';
import { services } from '../../state/services';
import { useViewer } from '../../state/viewer-store';

/** Menú «Más acciones» de la barra: acciones sobre el documento abierto (PDF-045). Sin documento está deshabilitado. */
export function DocumentMenu() {
  const { platform } = services();
  const ready = useViewer((s) => s.status === 'ready');
  const printAllowed = useViewer((s) => s.permissions.print);
  const copyAllowed = useViewer((s) => s.permissions.copy);
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
          disabled: !printAllowed,
          onSelect: () => { openPrintDialog(); },
        },
        {
          kind: 'action',
          label: compareMsg.menuItem,
          onSelect: () => { void startCompare(); },
        },
        {
          kind: 'action',
          label: organizeMsg.menuItem,
          disabled: !ready,
          onSelect: () => { void openOrganize(); },
        },
        {
          kind: 'action',
          label: organizeMsg.extractMenu,
          disabled: !copyAllowed,
          disabledReason: organizeMsg.extractBlocked,
          onSelect: () => { openExtractDialog(); },
        },
        {
          kind: 'action',
          label: organizeMsg.splitMenu,
          disabled: !copyAllowed,
          disabledReason: organizeMsg.extractBlocked,
          onSelect: () => { openSplitDialog(); },
        },
        {
          kind: 'action',
          label: exportMsg.menuItem,
          disabled: !copyAllowed,
          disabledReason: exportMsg.blocked,
          onSelect: () => { openExportDialog(); },
        },
      ]}
    >
      <IconMore />
    </MenuButton>
  );
}
