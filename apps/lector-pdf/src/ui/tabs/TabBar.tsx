import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { useTabs, type TabInfo } from '../../state/tabs';
import { closeTabById, switchTab } from '../../state/tab-actions';
import { IconClose, IconWarning } from '../icons';
import { tabsMsg } from '../messages-tabs';
import styles from './TabBar.module.css';

/** Id del elemento que muestra el documento activo; cada pestaña lo referencia con `aria-controls`. */
export const TAB_PANEL_ID = 'documento-activo';

const tabDomId = (id: string): string => `tab-${id}`;

/**
 * Barra de pestañas de los documentos abiertos (PDF-095). Solo se muestra con dos o más pestañas.
 * Patrón «Tabs» de WAI-ARIA con activación manual: ←/→ mueven el foco, Intro/Espacio activan, Supr cierra.
 */
export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // La pestaña activa se mantiene a la vista cuando la barra tiene scroll horizontal.
  useEffect(() => {
    if (activeId === null) return;
    buttons.current.get(activeId)?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [activeId, tabs.length]);

  if (tabs.length < 2) return null;

  const focusTab = (id: string | undefined): void => {
    if (id !== undefined) buttons.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const count = tabs.length;
    const id = tabs[index]?.id;
    if (id === undefined) return;
    switch (event.key) {
      case 'ArrowRight':
        focusTab(tabs[(index + 1) % count]?.id);
        break;
      case 'ArrowLeft':
        focusTab(tabs[(index - 1 + count) % count]?.id);
        break;
      case 'Home':
        focusTab(tabs[0]?.id);
        break;
      case 'End':
        focusTab(tabs[count - 1]?.id);
        break;
      case 'Enter':
      case ' ':
        switchTab(id);
        break;
      case 'Delete':
        // Tras cerrar, el foco vuelve a la pestaña activa (la enfocada ya no existe, o ha cambiado).
        void closeTabById(id).then((closed) => {
          if (closed) focusTab(useTabs.getState().activeId ?? undefined);
        });
        break;
      default:
        return;
    }
    // Las flechas y Inicio/Fin son de la barra: no llegan a los atajos del visor (páginas).
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className={styles.bar}>
      <div role="tablist" aria-label={tabsMsg.tabListLabel} aria-orientation="horizontal" className={styles.list}>
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            registerRef={(el) => {
              if (el === null) buttons.current.delete(tab.id);
              else buttons.current.set(tab.id, el);
            }}
            onKeyDown={(event) => { onKeyDown(event, index); }}
          />
        ))}
      </div>
    </div>
  );
}

interface TabItemProps {
  readonly tab: TabInfo;
  readonly active: boolean;
  readonly registerRef: (el: HTMLButtonElement | null) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

function TabItem({ tab, active, registerRef, onKeyDown }: TabItemProps) {
  const onMouseDown = (event: MouseEvent<HTMLButtonElement>): void => {
    // Clic central: cierra la pestaña (sin el desplazamiento automático que el navegador hace con este botón).
    if (event.button !== 1) return;
    event.preventDefault();
    void closeTabById(tab.id);
  };
  return (
    <div role="presentation" className={styles.item}>
      <button
        ref={registerRef}
        type="button"
        role="tab"
        id={tabDomId(tab.id)}
        className={styles.tab}
        aria-selected={active}
        aria-controls={TAB_PANEL_ID}
        aria-keyshortcuts="Delete"
        tabIndex={active ? 0 : -1}
        title={tab.title}
        onClick={() => { switchTab(tab.id); }}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      >
        {tab.dirty && <span className={styles.dirty}>• </span>}
        {tab.status === 'loading' && <span role="img" aria-label={tabsMsg.loading} className={styles.spinner} />}
        {tab.status === 'error' && (
          <span role="img" aria-label={tabsMsg.loadFailed} className={styles.failed}>
            <IconWarning />
          </span>
        )}
        <span className={styles.name}>{tab.title}</span>
        {tab.dirty && <span className={styles.srOnly}>{tabsMsg.unsavedChanges}</span>}
      </button>
      {/* Fuera del tab (no anidar botones dentro de role=tab); no entra en el orden de Tab: se usa Supr o el ratón. */}
      <button
        type="button"
        className={styles.close}
        aria-hidden="true"
        title={tabsMsg.closeNamed(tab.title)}
        tabIndex={-1}
        onClick={() => { void closeTabById(tab.id); }}
      >
        <IconClose />
      </button>
    </div>
  );
}
