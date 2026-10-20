import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { isFillable, type ChoiceOption, type FieldValue, type FormField, type FormWidget } from '../../core/forms';
import type { RectPt } from '../../core/annotations/model';
import type { PageViewport } from '../../engine/pdfjs';
import { focusAdjacentPage, setFieldValue, takePendingFocus } from '../../state/form-actions';
import { useAnnotations } from '../../state/annotation-store';
import { useAppearance } from '../../state/appearance-store';
import { useForms } from '../../state/form-store';
import { useViewer } from '../../state/viewer-store';
import { formMsg } from '../messages-forms';
import styles from './FormLayer.module.css';

/** Tamaño de letra por defecto de pdf.js cuando el campo no lo indica (`/DA` con 0 = automático), en puntos. */
const DEFAULT_FONT_PT = 12;
/** Tamaño automático de texto de una línea y de combo: `min(12, (alto − 4) / 1,15)` puntos (como pdf.js). */
const AUTO_LINE_PAD_PT = 4;
const AUTO_LINE_FACTOR = 1.15;
/** Tipos de campo que este control maneja (los botones sin valor no tienen control). */
const SUPPORTED_TYPES: ReadonlySet<FormField['type']> = new Set<FormField['type']>([
  'text',
  'combo',
  'list',
  'checkbox',
  'radio',
  'signature',
]);
const ALIGN_TEXT = ['left', 'center', 'right'] as const;

export interface FormLayerProps {
  /** Índice de la página (0-based). */
  readonly pageIndex: number;
  /** Viewport de la página con el mismo zoom y rotación que su lienzo (ver `PageView`). */
  readonly viewport: PageViewport;
}

/** Caja de un widget en píxeles del visor: envolvente de sus cuatro esquinas (como `LinkLayer`). */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Capa de formularios de una página (ADR-0019): un control HTML por widget de texto, combo y lista, encima de la
 * página. El lienzo pinta el valor con el storage de pdf.js; el control solo sirve para editar.
 */
export function FormLayer({ pageIndex, viewport }: FormLayerProps) {
  const names = useForms((s) => s.byPage.get(pageIndex));
  const fields = useForms((s) => s.fields);
  const highlight = useForms((s) => s.highlight);
  const values = useAnnotations((s) => s.edits.fields);
  const tool = useAnnotations((s) => s.tool);
  const night = useAppearance((s) => s.nightMode);
  const navSeq = useViewer((s) => s.navRequest?.seq);
  const layerRef = useRef<HTMLDivElement>(null);
  const passive = tool !== 'none';

  const controls: ReactNode[] = [];
  /**
   * Paradas de tabulación de la página en orden: una por campo, salvo los botones de opción, que son una sola
   * parada por grupo (el navegador las trata así). Tab y Mayús+Tab saltan a otra página desde sus extremos.
   */
  const tabStops: string[] = [];
  /** Parada de tabulación a la que pertenece cada widget rellenable. */
  const tabStopOf = new Map<string, string>();
  for (const name of names ?? []) {
    const field = fields.get(name);
    if (field === undefined || !SUPPORTED_TYPES.has(field.type)) continue;
    const value = values.get(field.name) ?? field.initial;
    for (const widget of field.widgets) {
      if (widget.pageIndex !== pageIndex) continue;
      if (isFillable(field)) {
        const stop = field.type === 'radio' ? `radio:${field.name}` : widget.id;
        tabStopOf.set(widget.id, stop);
        if (!tabStops.includes(stop)) tabStops.push(stop);
      }
      controls.push(
        <FormControl
          key={widget.id}
          field={field}
          widget={widget}
          value={value}
          viewport={viewport}
          highlight={highlight}
          night={night}
          passive={passive}
        />,
      );
    }
  }
  const controlCount = controls.length;

  // Al montarse la página (o al navegar), enfoca el widget que pidió Tab desde la página anterior (PDF-083).
  useEffect(() => {
    const id = takePendingFocus(pageIndex);
    if (!id) return;
    const target = Array.from(layerRef.current?.querySelectorAll<HTMLElement>('[data-widget-id]') ?? []).find(
      (el) => el.dataset.widgetId === id,
    );
    target?.focus();
  }, [pageIndex, controlCount, navSeq]);

  if (names === undefined) return null;
  const firstStop = tabStops[0];
  const lastStop = tabStops[tabStops.length - 1];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !(event.target instanceof HTMLElement)) return;
    const id = event.target.dataset.widgetId;
    if (id === undefined) return;
    const stop = tabStopOf.get(id);
    if (stop === undefined) return;
    const backward = event.shiftKey;
    if (backward ? stop !== firstStop : stop !== lastStop) return;
    if (focusAdjacentPage(pageIndex, backward ? -1 : 1)) event.preventDefault();
  };
  return (
    <div className={styles.layer} ref={layerRef} onKeyDown={onKeyDown}>
      {controls}
    </div>
  );
}

interface FormControlProps {
  readonly field: FormField;
  readonly widget: FormWidget;
  /** Valor efectivo: el cambiado por el usuario o, si no, el del fichero. */
  readonly value: FieldValue;
  readonly viewport: PageViewport;
  readonly highlight: boolean;
  readonly night: boolean;
  /** Hay una herramienta de anotación activa: los controles no reciben el puntero. */
  readonly passive: boolean;
}

function FormControl({ field, widget, value, viewport, highlight, night, passive }: FormControlProps) {
  const [focused, setFocused] = useState(false);
  const fillable = isFillable(field);
  const label = field.tooltip || field.name;
  const box = boxOf(viewport, widget.rect);
  const style: CSSProperties = {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    fontSize: fontSizePx(field, widget.rect, viewport.scale),
    textAlign: ALIGN_TEXT[field.align],
    ...(passive ? { pointerEvents: 'none' } : {}),
  };
  const className = [
    styles.control,
    focused ? styles.editing : styles.idle,
    highlight && fillable && !focused ? styles.highlight : '',
    fillable ? '' : styles.readOnly,
    night ? styles.night : '',
  ]
    .filter((c) => c !== '')
    .join(' ');
  const common = {
    className,
    style,
    'data-widget-id': widget.id,
    'aria-label': label,
    'aria-required': field.required || undefined,
    title: label,
    onFocus: () => {
      setFocused(true);
    },
    onBlur: () => {
      setFocused(false);
    },
  };
  const commitChoice = (selected: readonly string[]): void => {
    setFieldValue(field.name, { kind: 'choice', selected });
  };

  if (field.type === 'text') {
    return (
      <TextEntry
        {...common}
        current={value.kind === 'text' ? value.text : ''}
        multiline={field.multiline}
        password={field.password}
        maxLength={field.maxLen > 0 ? field.maxLen : undefined}
        readOnly={!fillable}
        onCommit={(text) => {
          setFieldValue(field.name, { kind: 'text', text });
        }}
      />
    );
  }

  if (field.type === 'checkbox' || field.type === 'radio') {
    const toggleClass = [
      styles.control,
      styles.toggle,
      highlight && fillable && !focused ? styles.highlight : '',
      night ? styles.night : '',
    ]
      .filter((c) => c !== '')
      .join(' ');
    if (field.type === 'checkbox') {
      return (
        <input
          {...common}
          className={toggleClass}
          type="checkbox"
          disabled={!fillable}
          checked={value.kind === 'checkbox' && value.checked}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setFieldValue(field.name, { kind: 'checkbox', checked: event.currentTarget.checked });
          }}
        />
      );
    }
    // Un control por widget: el nombre accesible incluye el campo y su estado («color: Azul»); las flechas recorren el grupo `name`.
    const onState = widget.onState;
    return (
      <input
        {...common}
        className={toggleClass}
        type="radio"
        name={`campo:${field.name}`}
        aria-label={onState === null ? label : formMsg.radioOptionName(label, onState)}
        disabled={!fillable}
        checked={value.kind === 'radio' && onState !== null && value.selected === onState}
        onChange={() => {
          if (onState !== null) setFieldValue(field.name, { kind: 'radio', selected: onState });
        }}
      />
    );
  }

  if (field.type === 'signature') {
    return (
      <div
        className={[styles.control, styles.signature, night ? styles.night : ''].filter((c) => c !== '').join(' ')}
        style={style}
        role="img"
        aria-label={formMsg.signatureField}
        title={formMsg.signatureTitle}
      />
    );
  }

  const selected = value.kind === 'choice' ? value.selected : [];
  if (field.type === 'combo' && field.editable) {
    return (
      <TextEntry
        {...common}
        current={selected[0] ?? ''}
        options={field.options}
        readOnly={!fillable}
        onCommit={(text) => {
          commitChoice([text]);
        }}
      />
    );
  }

  if (field.type === 'combo') {
    return (
      <select
        {...common}
        disabled={!fillable}
        value={selected[0] ?? ''}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          commitChoice([event.currentTarget.value]);
        }}
      >
        {field.options.map((option) => (
          <option key={option.exportValue} value={option.exportValue}>
            {option.displayValue}
          </option>
        ))}
      </select>
    );
  }

  return (
    <select
      {...common}
      disabled={!fillable}
      multiple={field.multiSelect}
      size={Math.max(2, field.options.length)}
      value={field.multiSelect ? selected : (selected[0] ?? '')}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
        commitChoice(Array.from(event.currentTarget.selectedOptions, (option) => option.value));
      }}
    >
      {field.options.map((option) => (
        <option key={option.exportValue} value={option.exportValue}>
          {option.displayValue}
        </option>
      ))}
    </select>
  );
}

interface TextEntryProps {
  readonly className: string;
  readonly style: CSSProperties;
  readonly 'aria-label': string;
  readonly 'aria-required': true | undefined;
  readonly 'data-widget-id': string;
  readonly title: string;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  /** Texto del campo cuando no se edita. */
  readonly current: string;
  readonly multiline?: boolean;
  readonly password?: boolean;
  readonly maxLength?: number | undefined;
  readonly readOnly: boolean;
  /** Opciones sugeridas (combo editable): se muestran en una lista de sugerencias. */
  readonly options?: readonly ChoiceOption[];
  /** Confirma el texto escrito: una sola entrada de deshacer por confirmación. */
  readonly onCommit: (text: string) => void;
}

/**
 * Campo de texto de una línea o multilínea (y el texto de un combo editable). Mientras tiene el foco guarda el
 * texto escrito en un borrador local; lo confirma al salir del campo o con Intro (no en multilínea). Esc lo descarta.
 */
function TextEntry({
  className,
  style,
  'aria-label': ariaLabel,
  'aria-required': ariaRequired,
  'data-widget-id': widgetId,
  title,
  onFocus,
  onBlur,
  current,
  multiline = false,
  password = false,
  maxLength,
  readOnly,
  options,
  onCommit,
}: TextEntryProps) {
  /** Texto escrito sin confirmar; `null` si el campo no se ha tocado desde el último cambio confirmado. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Esc está descartando el borrador: el `blur` que provoca el cambio de foco no debe confirmarlo. */
  const discarding = useRef(false);
  const listId = useId();
  const shown = draft ?? current;

  const confirm = (text: string): void => {
    setDraft(null);
    onCommit(text);
  };
  const handleBlur = (): void => {
    onBlur();
    if (discarding.current || draft === null) return;
    confirm(draft);
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setDraft(event.currentTarget.value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      discarding.current = true;
      setDraft(null);
      document.querySelector<HTMLElement>('[data-testid="viewer"]')?.focus();
      discarding.current = false;
      return;
    }
    if (event.key === 'Enter' && !multiline) {
      event.preventDefault();
      confirm(event.currentTarget.value);
    }
  };

  const shared = {
    className,
    style,
    'aria-label': ariaLabel,
    'aria-required': ariaRequired,
    'data-widget-id': widgetId,
    title,
    readOnly,
    value: shown,
    onFocus,
    onBlur: handleBlur,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
  };

  if (multiline) {
    return <textarea {...shared} maxLength={maxLength} />;
  }
  return (
    <>
      <input
        {...shared}
        type={password ? 'password' : 'text'}
        maxLength={maxLength}
        {...(options === undefined ? {} : { list: listId })}
      />
      {options !== undefined && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.exportValue} value={option.exportValue}>
              {option.displayValue}
            </option>
          ))}
        </datalist>
      )}
    </>
  );
}

/** Caja en píxeles del widget: las cuatro esquinas pasadas al viewport (que puede estar girado) y su envolvente. */
function boxOf(viewport: PageViewport, rect: RectPt): Box {
  const [x1, y1, x2, y2] = rect;
  const corners = [
    viewport.convertToViewportPoint(x1, y1),
    viewport.convertToViewportPoint(x2, y1),
    viewport.convertToViewportPoint(x2, y2),
    viewport.convertToViewportPoint(x1, y2),
  ].map((point) => point as readonly number[]);
  const xs = corners.map(([x = 0]) => x);
  const ys = corners.map(([, y = 0]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** Tamaño de letra en píxeles: el del campo; si es automático, la fórmula de una línea para combos y textos de una línea. */
function fontSizePx(field: FormField, rect: RectPt, scale: number): number {
  if (field.fontSize > 0) return field.fontSize * scale;
  const heightPt = Math.abs(rect[3] - rect[1]);
  const singleLine = field.type === 'combo' || (field.type === 'text' && !field.multiline);
  if (!singleLine) return DEFAULT_FONT_PT * scale;
  const fitted = (heightPt - AUTO_LINE_PAD_PT) / AUTO_LINE_FACTOR;
  return Math.min(DEFAULT_FONT_PT, Math.max(1, fitted)) * scale;
}
