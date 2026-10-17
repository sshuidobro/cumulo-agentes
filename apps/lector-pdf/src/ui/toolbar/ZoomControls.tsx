import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { parseZoomInput, formatZoom, type ZoomMode } from '../../core/zoom';
import { formatShortcut } from '../shortcuts';
import { IconButton } from '../kit/IconButton';
import { IconZoomIn, IconZoomOut } from '../icons';
import { msg } from '../messages';
import { services } from '../../state/services';
import { setZoomMode, zoomIn, zoomOut } from '../../state/view-actions';
import { useViewer } from '../../state/viewer-store';
import styles from './ZoomControls.module.css';

/** Porcentajes fijos de la lista de zoom. */
export const ZOOM_PRESET_PERCENTS: readonly number[] = [50, 75, 100, 125, 150, 200, 300, 400];

/** Tiempo que el campo de zoom muestra el borde de error, en ms. */
const INVALID_MS = 1000;

const EPSILON = 1e-6;

/** Valor de la lista de zoom que corresponde al modo actual. Vacío si un zoom personalizado no tiene opción. */
export function zoomOptionValue(mode: ZoomMode, zoom: number): string {
  switch (mode.kind) {
    case 'auto':
      return 'auto';
    case 'fit-width':
      return 'fit-width';
    case 'fit-page':
      return 'fit-page';
    case 'custom':
      if (Math.abs(zoom - 1) < EPSILON) return 'actual';
      return ZOOM_PRESET_PERCENTS.find((p) => Math.abs(zoom - p / 100) < EPSILON)?.toString() ?? '';
  }
}

/** Modo de zoom que elige una opción de la lista. */
export function zoomModeForOption(value: string): ZoomMode | null {
  switch (value) {
    case 'auto':
      return { kind: 'auto' };
    case 'fit-width':
      return { kind: 'fit-width' };
    case 'fit-page':
      return { kind: 'fit-page' };
    case 'actual':
      return { kind: 'custom', zoom: 1 };
    default: {
      const percent = Number(value);
      return Number.isFinite(percent) && percent > 0 ? { kind: 'custom', zoom: percent / 100 } : null;
    }
  }
}

/** Botones de alejar y acercar, campo de porcentaje y lista de ajustes de zoom. */
export function ZoomControls() {
  const { platform } = services();
  const ready = useViewer((s) => s.status === 'ready');
  const zoom = useViewer((s) => s.zoom);
  const mode = useViewer((s) => s.zoomMode);
  /** Texto que escribe el usuario; `null` cuando el campo muestra el zoom actual. */
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!invalid) return undefined;
    const timer = setTimeout(() => {
      setInvalid(false);
    }, INVALID_MS);
    return () => clearTimeout(timer);
  }, [invalid]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const parsed = parseZoomInput(event.currentTarget.value);
    if (parsed === null) {
      setDraft(null);
      setInvalid(true);
      return;
    }
    setDraft(null);
    setZoomMode({ kind: 'custom', zoom: parsed });
  };

  const onSelect = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = zoomModeForOption(event.currentTarget.value);
    if (next !== null) setZoomMode(next);
  };

  const zoomInShortcut = formatShortcut('zoom-in', platform.isMac);
  const zoomOutShortcut = formatShortcut('zoom-out', platform.isMac);

  return (
    <>
      <IconButton label={msg.zoomOut} shortcut={zoomOutShortcut} disabled={!ready} onClick={() => { zoomOut(); }}>
        <IconZoomOut />
      </IconButton>
      <IconButton label={msg.zoomIn} shortcut={zoomInShortcut} disabled={!ready} onClick={() => { zoomIn(); }}>
        <IconZoomIn />
      </IconButton>
      <input
        type="text"
        inputMode="decimal"
        className={invalid ? `${styles.input} ${styles.invalid}` : styles.input}
        aria-label={msg.zoomInput}
        aria-invalid={invalid}
        aria-describedby={invalid ? 'zoom-invalid-message' : undefined}
        value={draft ?? formatZoom(zoom)}
        disabled={!ready}
        onChange={(event) => { setDraft(event.currentTarget.value); }}
        onKeyDown={onInputKeyDown}
        onBlur={() => { setDraft(null); }}
      />
      {invalid && (
        <span id="zoom-invalid-message" role="alert" className={styles.srOnly}>
          {msg.zoomInvalid}
        </span>
      )}
      <select
        className={styles.select}
        aria-label={msg.zoomPresets}
        value={zoomOptionValue(mode, zoom)}
        disabled={!ready}
        onChange={onSelect}
      >
        <option value="" disabled />
        <option value="auto">{msg.zoomAuto}</option>
        <option value="fit-width">{msg.fitWidth}</option>
        <option value="fit-page">{msg.fitPage}</option>
        <option value="actual">{msg.actualSize}</option>
        {ZOOM_PRESET_PERCENTS.map((p) => (
          <option key={p} value={String(p)}>
            {msg.zoomPercent(p)}
          </option>
        ))}
      </select>
    </>
  );
}
