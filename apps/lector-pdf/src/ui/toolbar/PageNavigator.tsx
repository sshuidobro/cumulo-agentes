import { useId, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { formatPageIndicator, parsePageInput } from '../../core/page-input';
import { IconButton } from '../kit/IconButton';
import { IconNextPage, IconPrevPage } from '../icons';
import { msg } from '../messages';
import { formatShortcut } from '../shortcuts';
import { services } from '../../state/services';
import { goToPage, nextPage, prevPage } from '../../state/navigation';
import { useViewer } from '../../state/viewer-store';
import styles from './PageNavigator.module.css';

/** Campo de página montado ahora mismo (solo hay una barra principal). */
let pageField: HTMLInputElement | null = null;

/** Enfoca el campo de página y selecciona su texto (Ctrl+Mayús+N). Sin campo montado no hace nada. */
export function focusPageField(): void {
  if (pageField === null) return;
  pageField.focus();
  pageField.select();
}

/** Anterior, campo «página actual» (con etiquetas del PDF si las tiene) y siguiente. */
export function PageNavigator() {
  const { platform } = services();
  const ready = useViewer((s) => s.status === 'ready');
  const numPages = useViewer((s) => s.dims?.count ?? 0);
  const currentPage = useViewer((s) => s.currentPage);
  const labels = useViewer((s) => s.pageLabels);
  /** Texto que escribe el usuario; `null` cuando el campo muestra la página actual. */
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const messageId = useId();

  const indicator =
    numPages > 0 ? formatPageIndicator(currentPage, numPages, labels) : { inputValue: '', suffix: '' };
  const atFirst = currentPage <= 0;
  const atLast = currentPage >= numPages - 1;

  const restore = (): void => {
    setDraft(null);
    setInvalid(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      restore();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const index = parsePageInput(event.currentTarget.value, numPages, labels);
    if (index === null) {
      setInvalid(true);
      return;
    }
    restore();
    goToPage(index);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraft(event.currentTarget.value);
    setInvalid(false);
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>): void => {
    event.currentTarget.select();
  };

  return (
    <>
      <IconButton
        label={msg.prevPage}
        shortcut={formatShortcut('prev-page', platform.isMac)}
        disabled={!ready || atFirst}
        onClick={() => { prevPage(); }}
      >
        <IconPrevPage />
      </IconButton>
      <input
        ref={(el) => {
          pageField = el;
        }}
        type="text"
        inputMode="numeric"
        className={invalid ? `${styles.input} ${styles.invalid}` : styles.input}
        aria-label={msg.pageNumber}
        aria-invalid={invalid}
        aria-describedby={invalid ? messageId : undefined}
        title={invalid ? msg.pageInvalid(numPages) : undefined}
        value={draft ?? indicator.inputValue}
        disabled={!ready}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={restore}
      />
      <span className={styles.suffix}>{indicator.suffix}</span>
      {invalid && (
        <span id={messageId} role="alert" className={styles.srOnly}>
          {msg.pageInvalid(numPages)}
        </span>
      )}
      <IconButton
        label={msg.nextPage}
        shortcut={formatShortcut('next-page', platform.isMac)}
        disabled={!ready || atLast}
        onClick={() => { nextPage(); }}
      >
        <IconNextPage />
      </IconButton>
    </>
  );
}
