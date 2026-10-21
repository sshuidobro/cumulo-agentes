import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import type { SidebarTab } from '../../core/sidebar';
import { useSignatures } from '../../state/digital-signature-actions';
import { showSidebarTab } from '../../state/sidebar-actions';
import { useViewer } from '../../state/viewer-store';
import { digitalSignMsg } from '../messages-digital-signature';
import { msg } from '../messages';
import { CommentsPanel } from './CommentsPanel';
import { OutlinePanel } from './OutlinePanel';
import { SignaturesPanel } from './SignaturesPanel';
import { Thumbnails } from './Thumbnails';
import styles from './Sidebar.module.css';

interface SidebarTabDef {
  readonly id: SidebarTab;
  readonly label: string;
  readonly panel: () => ReactElement;
}

/** Pestañas del panel. */
const SIDEBAR_TABS: readonly SidebarTabDef[] = [
  { id: 'thumbnails', label: msg.thumbnails, panel: () => <Thumbnails /> },
  { id: 'outline', label: msg.bookmarks, panel: () => <OutlinePanel /> },
  { id: 'comments', label: msg.comments, panel: () => <CommentsPanel /> },
];

/** Pestaña «Firmas» (PDF-139): solo si el documento tiene firmas o se está comprobando (o si ya está seleccionada). */
const SIGNATURES_TAB: SidebarTabDef = { id: 'signatures', label: digitalSignMsg.tabSignatures, panel: () => <SignaturesPanel /> };

function tabDomId(id: SidebarTab): string {
  return `sidebar-tab-${id}`;
}

function panelDomId(id: SidebarTab): string {
  return `sidebar-panel-${id}`;
}

/**
 * Panel lateral izquierdo con pestañas (patrón ARIA *tabs*). Las flechas izquierda y derecha cambian de
 * pestaña; no pasan de página, que es lo que hacen fuera del panel.
 */
export function Sidebar() {
  const active = useViewer((s) => s.sidebar);
  const hasSignatures = useSignatures((s) => s.status === 'checking' || s.status === 'error' || s.list.length > 0);
  const tabs = hasSignatures || active === 'signatures' ? [...SIDEBAR_TABS, SIGNATURES_TAB] : SIDEBAR_TABS;
  const tabRefs = useRef(new Map<SidebarTab, HTMLButtonElement>());
  const selected = tabs.find((tab) => tab.id === active);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const current = Math.max(0, tabs.findIndex((tab) => tab.id === active));
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(current + step + tabs.length) % tabs.length];
    if (next === undefined) return;
    showSidebarTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  return (
    <aside className={styles.sidebar} aria-label={msg.sidebar}>
      <div role="tablist" aria-label={msg.sidebarTabs} className={styles.tabs} onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => {
          const isSelected = tab.id === active;
          // Si el estado guardado no corresponde a ninguna pestaña, la primera queda accesible con Tab.
          const focusable = isSelected || (selected === undefined && index === 0);
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node !== null) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tabDomId(tab.id)}
              aria-selected={isSelected}
              aria-controls={isSelected ? panelDomId(tab.id) : undefined}
              tabIndex={focusable ? 0 : -1}
              className={isSelected ? `${styles.tab} ${styles.tabSelected}` : styles.tab}
              onClick={() => { showSidebarTab(tab.id); }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {selected !== undefined && (
        <div
          role="tabpanel"
          id={panelDomId(selected.id)}
          aria-labelledby={tabDomId(selected.id)}
          className={styles.panel}
        >
          {selected.panel()}
        </div>
      )}
    </aside>
  );
}
