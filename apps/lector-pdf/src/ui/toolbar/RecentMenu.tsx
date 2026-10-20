import { MenuButton, type MenuEntry } from '../kit/MenuButton';
import { IconRecent } from '../icons';
import { tabsMsg } from '../messages-tabs';
import { forgetAllRecent, openRecentFile, useRecent } from '../../state/recent-actions';

/** Menú «Abrir recientes» junto a «Abrir» (PDF-049): los últimos documentos y la opción de vaciar la lista. */
export function RecentMenu() {
  const list = useRecent((s) => s.list);
  const entries: MenuEntry[] = list.map((entry) => ({
    kind: 'action',
    label: entry.name,
    onSelect: () => { void openRecentFile(entry.id); },
  }));
  if (list.length > 0) {
    entries.push('separator', {
      kind: 'action',
      label: tabsMsg.recentClear,
      onSelect: () => { void forgetAllRecent(); },
    });
  }
  return (
    <MenuButton label={tabsMsg.recentMenu} disabled={list.length === 0} entries={entries}>
      <IconRecent />
    </MenuButton>
  );
}
