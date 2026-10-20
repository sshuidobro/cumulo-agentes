import type { ChangeEvent, KeyboardEvent } from 'react';
import { READ_ALOUD_RATES } from '../../core/read-aloud/voices';
import { setRate, setVoice, stopReading, togglePause, useReadAloud } from '../../state/read-aloud-actions';
import { useViewer } from '../../state/viewer-store';
import { readAloudMsg } from '../messages-read-aloud';
import styles from './ReadAloudBar.module.css';

/** Velocidad como la muestra el selector: «1×», «1,25×» (coma decimal, como en el resto de la interfaz). */
export function formatRate(rate: number): string {
  return `${String(rate).replace('.', ',')}×`;
}

/** Devuelve el foco al visor, que es donde estaba antes de la barra. */
function focusViewer(): void {
  document.querySelector<HTMLElement>('[data-testid="viewer"]')?.focus();
}

/** Para la lectura desde la barra y devuelve el foco al visor (la barra desaparece). */
function stopFromBar(): void {
  stopReading();
  focusViewer();
}

/**
 * Barra flotante de lectura en voz alta (PDF-114): pausa/reanuda, parar, velocidad, voz y página que se lee.
 * Solo se muestra mientras hay una lectura. Espacio pausa o reanuda y Esc para la lectura cuando la barra tiene el foco.
 */
export function ReadAloudBar() {
  const status = useReadAloud((s) => s.status);
  const current = useReadAloud((s) => s.current);
  const rate = useReadAloud((s) => s.rate);
  const voiceId = useReadAloud((s) => s.voiceId);
  const voices = useReadAloud((s) => s.voices);
  const currentPage = useViewer((s) => s.currentPage);

  if (status === 'idle') return null;

  const paused = status === 'paused';
  const page = (current?.pageIndex ?? currentPage) + 1;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      stopFromBar();
      return;
    }
    // Espacio sobre la propia barra. Sobre un botón o un selector lo resuelve el control.
    if (event.key === ' ' && event.target === event.currentTarget) {
      event.preventDefault();
      togglePause();
    }
  };

  const onRateChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = READ_ALOUD_RATES.find((r) => String(r) === event.currentTarget.value);
    if (next !== undefined) setRate(next);
  };

  return (
    <div
      role="toolbar"
      aria-label={readAloudMsg.toolbar}
      className={styles.bar}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className={paused ? `${styles.button} ${styles.buttonOn}` : styles.button}
        aria-label={readAloudMsg.pause}
        aria-pressed={paused}
        title={paused ? readAloudMsg.resume : readAloudMsg.pause}
        disabled={status === 'loading'}
        onClick={togglePause}
      >
        <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span>
      </button>
      <button type="button" className={styles.button} onClick={stopFromBar}>
        {readAloudMsg.stop}
      </button>
      <label className={styles.field}>
        <span className={styles.label}>{readAloudMsg.speed}</span>
        <select className={styles.select} value={String(rate)} onChange={onRateChange}>
          {READ_ALOUD_RATES.map((r) => (
            <option key={r} value={String(r)}>
              {formatRate(r)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{readAloudMsg.voice}</span>
        <select
          className={styles.select}
          value={voiceId ?? ''}
          onChange={(event) => {
            setVoice(event.currentTarget.value);
          }}
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {`${v.name} (${v.lang})`}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.text}>{readAloudMsg.readingPage(page)}</span>
    </div>
  );
}
