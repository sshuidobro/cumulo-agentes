import { useEffect, useMemo, type ChangeEvent, type KeyboardEvent, type SVGProps } from 'react';
import { matchOrdinal } from '../../core/search/cursor';
import { cancelSearch, closeSearch, nextMatch, prevMatch, setQuery, toggleOption } from '../../state/search-actions';
import { services } from '../../state/services';
import { useSearch, type SearchOptionName } from '../../state/search-store';
import { IconButton } from '../kit/IconButton';
import { msg } from '../messages';
import { formatShortcut } from '../shortcuts';
import styles from './SearchBar.module.css';

/** Campo de búsqueda montado ahora mismo (solo hay una barra). */
let searchField: HTMLInputElement | null = null;

/** Enfoca el campo de búsqueda y selecciona su texto (Ctrl+F). Sin barra montada no hace nada. */
export function focusSearchField(): void {
  if (searchField === null) return;
  searchField.focus();
  searchField.select();
}

/** Devuelve el foco al visor. */
function focusViewer(): void {
  document.querySelector<HTMLElement>('[data-testid="viewer"]')?.focus();
}

const OPTIONS: readonly { readonly name: SearchOptionName; readonly label: string }[] = [
  { name: 'matchCase', label: msg.matchCase },
  { name: 'wholeWord', label: msg.wholeWord },
  { name: 'matchDiacritics', label: msg.matchDiacritics },
];

/**
 * Barra de búsqueda flotante sobre el visor: consulta, siguiente y anterior, opciones, estado y progreso.
 * Intro va a la siguiente coincidencia, Mayús+Intro a la anterior y Esc cierra la barra.
 */
export function SearchBar() {
  const { platform } = services();
  const open = useSearch((s) => s.open);
  const query = useSearch((s) => s.query);
  const options = useSearch((s) => s.options);
  const status = useSearch((s) => s.status);
  const total = useSearch((s) => s.total);
  const truncated = useSearch((s) => s.truncated);
  const progress = useSearch((s) => s.progress);
  const current = useSearch((s) => s.current);
  const pagesWithMatches = useSearch((s) => s.pagesWithMatches);
  const matchesByPage = useSearch((s) => s.matchesByPage);

  const ordinal = useMemo(
    () =>
      current === null
        ? 0
        : matchOrdinal(pagesWithMatches, (page) => matchesByPage.get(page)?.length ?? 0, current),
    [current, pagesWithMatches, matchesByPage],
  );

  useEffect(() => {
    if (open) focusSearchField();
  }, [open]);

  if (!open) return null;

  const searching = status === 'searching';
  const hasMatches = total > 0 && current !== null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeSearch();
    focusViewer();
  };

  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === 'F3') {
      event.preventDefault();
      if (event.shiftKey) prevMatch();
      else nextMatch();
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.currentTarget.value);
  };

  return (
    <div className={styles.bar} role="search" onKeyDown={onKeyDown}>
      <input
        ref={(el) => {
          searchField = el;
        }}
        type="search"
        className={styles.field}
        aria-label={msg.searchInput}
        placeholder={msg.searchPlaceholder}
        value={query}
        onChange={onChange}
        onKeyDown={onFieldKeyDown}
      />
      <IconButton
        label={msg.prevMatch}
        shortcut={formatShortcut('find-prev', platform.isMac)}
        disabled={!hasMatches}
        onClick={prevMatch}
      >
        <IconUp />
      </IconButton>
      <IconButton
        label={msg.nextMatch}
        shortcut={formatShortcut('find-next', platform.isMac)}
        disabled={!hasMatches}
        onClick={nextMatch}
      >
        <IconDown />
      </IconButton>
      {OPTIONS.map(({ name, label }) => (
        <button
          key={name}
          type="button"
          className={options[name] ? `${styles.option} ${styles.optionOn}` : styles.option}
          aria-pressed={options[name]}
          title={label}
          onClick={() => {
            toggleOption(name);
          }}
        >
          {label}
        </button>
      ))}
      <div className={styles.status} aria-live="polite">
        {searching && progress !== null && (
          <>
            <progress className={styles.progress} max={progress.total} value={progress.searched} aria-hidden="true" />
            <span>{msg.searching(progress.searched, progress.total)}</span>
          </>
        )}
        {hasMatches && <span>{msg.matchCounter(ordinal, total)}</span>}
        {!searching && status === 'done' && query !== '' && total === 0 && <span>{msg.noMatches}</span>}
        {truncated && <span>{msg.truncatedMatches}</span>}
      </div>
      {searching && (
        <button
          type="button"
          className={styles.option}
          onClick={() => {
            cancelSearch();
          }}
        >
          {msg.stopSearch}
        </button>
      )}
      <IconButton label={msg.closeSearch} onClick={() => {
        closeSearch();
        focusViewer();
      }}>
        <IconClose />
      </IconButton>
    </div>
  );
}

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

function IconUp() {
  return (
    <Svg>
      <path d="M5 12.5 10 7.5l5 5" />
    </Svg>
  );
}

function IconDown() {
  return (
    <Svg>
      <path d="M5 7.5 10 12.5l5-5" />
    </Svg>
  );
}

function IconClose() {
  return (
    <Svg>
      <path d="M6 6l8 8M14 6l-8 8" />
    </Svg>
  );
}
