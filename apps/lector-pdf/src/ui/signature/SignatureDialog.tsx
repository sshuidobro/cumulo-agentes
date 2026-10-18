import '@fontsource/dancing-script/400.css';
import { useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react';
import type { SignatureArt } from '../../core/annotations/model';
import { simplifyPath } from '../../core/annotations/simplify';
import { inkArtFromStrokes } from '../../core/signature/stored';
import { saveSignature } from '../../state/signature-actions';
import { Dialog } from '../kit/Dialog';
import { drawInkSegments } from '../viewer/ink-preview';
import { signatureMsg } from '../messages-signature';
import { signatureFromImageFile } from './image-art';
import { rasterizeSignatureText } from './text-art';
import styles from './SignatureDialog.module.css';

export interface SignatureDialogProps {
  readonly open: boolean;
  readonly onDone: (art: SignatureArt) => void;
  readonly onCancel: () => void;
}

type Tab = 'draw' | 'text' | 'image';
const TABS: readonly Tab[] = ['draw', 'text', 'image'];
const TAB_LABEL: Readonly<Record<Tab, string>> = {
  draw: signatureMsg.tabDraw,
  text: signatureMsg.tabText,
  image: signatureMsg.tabImage,
};

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 160;
/** Grosor del trazo dibujado, en píxeles del lienzo. */
const INK_WIDTH = 2;
/** Tolerancia de simplificación de cada trazo, en píxeles. */
const SIMPLIFY_TOLERANCE = 0.5;
const MAX_TEXT_LENGTH = 60;

/** Diálogo modal «Crear firma» (PDF-086). Cada apertura empieza con todo vacío. */
export function SignatureDialog({ open, onDone, onCancel }: SignatureDialogProps) {
  if (!open) return null;
  return <SignatureSession onDone={onDone} onCancel={onCancel} />;
}

function SignatureSession({ onDone, onCancel }: Omit<SignatureDialogProps, 'open'>) {
  const baseId = useId();
  const [tab, setTab] = useState<Tab>('draw');
  const [hasInk, setHasInk] = useState(false);
  const [text, setText] = useState('');
  const [imageArt, setImageArt] = useState<SignatureArt | null>(null);
  const [imageMessage, setImageMessage] = useState<{ readonly text: string; readonly error: boolean } | null>(null);
  const [reading, setReading] = useState(false);
  const [keep, setKeep] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Trazos terminados, en píxeles del lienzo. */
  const strokes = useRef<number[][]>([]);
  /** Trazo en curso y cuántos de sus puntos ya están dibujados. */
  const current = useRef<number[] | null>(null);
  const drawn = useRef(0);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const canAccept =
    !reading &&
    (tab === 'draw' ? hasInk : tab === 'text' ? text.trim() !== '' : imageArt !== null);

  const selectTab = (next: Tab): void => {
    setTab(next);
    tabButtons.current[TABS.indexOf(next)]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = (TABS.indexOf(tab) + step + TABS.length) % TABS.length;
    selectTab(TABS[index] ?? 'draw');
  };

  const pointOf = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const [x, y] = pointOf(event);
    current.current = [x, y];
    drawn.current = 0;
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const points = current.current;
    if (points === null) return;
    const [x, y] = pointOf(event);
    points.push(x, y);
    const ctx = contextOf(event.currentTarget);
    if (ctx !== null) drawn.current = drawInkSegments(ctx, points, drawn.current);
  };

  const endStroke = (): void => {
    const points = current.current;
    current.current = null;
    if (points === null || points.length < 4) return;
    strokes.current.push(points);
    setHasInk(true);
  };

  const clearInk = (): void => {
    strokes.current = [];
    current.current = null;
    setHasInk(false);
    const canvas = canvasRef.current;
    contextOf(canvas)?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  };

  const onFileChosen = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file === undefined) return;
    setReading(true);
    setImageMessage(null);
    const result = await signatureFromImageFile(file);
    setReading(false);
    if (result.ok) {
      setImageArt(result.value);
      setImageMessage({ text: signatureMsg.imageSelected, error: false });
    } else {
      setImageArt(null);
      setImageMessage({ text: result.error.message, error: true });
    }
  };

  /** Firma del contenido de la pestaña activa; `null` si no hay nada que aceptar. */
  const currentArt = async (): Promise<SignatureArt | null> => {
    if (tab === 'draw') {
      return inkArtFromStrokes(
        strokes.current.map((s) => simplifyPath(s, SIMPLIFY_TOLERANCE)),
        INK_WIDTH,
      );
    }
    if (tab === 'text') return rasterizeSignatureText(text);
    return imageArt;
  };

  const accept = async (): Promise<void> => {
    const art = await currentArt();
    if (art === null) return;
    if (keep) saveSignature(art);
    onDone(art);
  };

  return (
    <Dialog
      open
      title={signatureMsg.title}
      onClose={onCancel}
      actions={[
        { label: signatureMsg.accept, onClick: () => { void accept(); }, disabled: !canAccept },
        { label: signatureMsg.cancel, onClick: onCancel },
      ]}
    >
      <div role="tablist" aria-label={signatureMsg.tabsLabel} className={styles.tabs} onKeyDown={onTabKeyDown}>
        {TABS.map((item, index) => (
          <button
            key={item}
            ref={(node) => { tabButtons.current[index] = node; }}
            id={`${baseId}-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => { selectTab(item); }}
          >
            {TAB_LABEL[item]}
          </button>
        ))}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className={styles.panel}>
        {tab === 'draw' && (
          <div className={styles.drawArea}>
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              aria-label={signatureMsg.canvasLabel}
              className={styles.canvas}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={endStroke}
            />
            <div>
              <button type="button" className={styles.secondary} onClick={clearInk}>
                {signatureMsg.clear}
              </button>
            </div>
          </div>
        )}

        {tab === 'text' && (
          <div className={styles.textArea}>
            <label className={styles.field}>
              {signatureMsg.textLabel}
              <input
                type="text"
                value={text}
                maxLength={MAX_TEXT_LENGTH}
                className={styles.input}
                onChange={(event) => { setText(event.currentTarget.value); }}
              />
            </label>
            <div role="img" aria-label={signatureMsg.textPreview} className={styles.preview}>
              {text}
            </div>
          </div>
        )}

        {tab === 'image' && (
          <div className={styles.imageArea}>
            <button type="button" className={styles.secondary} onClick={() => { fileInput.current?.click(); }}>
              {signatureMsg.chooseImage}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              onChange={(event) => { void onFileChosen(event); }}
            />
            <p className={styles.hint}>{signatureMsg.imageHint}</p>
            {reading && <p role="status">{signatureMsg.imageReading}</p>}
            {imageMessage !== null && (
              <p role={imageMessage.error ? 'alert' : 'status'} className={imageMessage.error ? styles.error : styles.hint}>
                {imageMessage.text}
              </p>
            )}
          </div>
        )}
      </div>

      <label className={styles.keep}>
        <input type="checkbox" checked={keep} onChange={(event) => { setKeep(event.currentTarget.checked); }} />
        {signatureMsg.save}
      </label>
    </Dialog>
  );
}

/** Contexto 2D del lienzo de dibujo con el estilo del trazo; `null` sin canvas en el entorno. */
function contextOf(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  const ctx = canvas?.getContext('2d') ?? null;
  if (ctx !== null) {
    ctx.lineWidth = INK_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
  }
  return ctx;
}
