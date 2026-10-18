/**
 * Clasificación de los enlaces de un PDF. Lógica pura: el documento es entrada no confiable, así que
 * solo se permiten destinos internos, acciones con nombre y los protocolos web y de correo.
 */

/** Destino de un enlace: nombre (`string`) o array explícito `[página, /XYZ, ...]` tal como lo da pdf.js. */
export type PdfDest = string | readonly unknown[];

/** Acciones con nombre del estándar PDF que la app sabe atender. */
export type NamedAction = 'next-page' | 'prev-page' | 'first-page' | 'last-page' | 'back' | 'forward';

export type LinkTarget =
  | { readonly kind: 'internal'; readonly dest: PdfDest }
  | { readonly kind: 'action'; readonly action: NamedAction }
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'blocked'; readonly reason: 'unsafe-url' | 'unsupported' };

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

const NAMED_ACTIONS: ReadonlyMap<string, NamedAction> = new Map<string, NamedAction>([
  ['NextPage', 'next-page'],
  ['PrevPage', 'prev-page'],
  ['FirstPage', 'first-page'],
  ['LastPage', 'last-page'],
  ['GoBack', 'back'],
  ['GoForward', 'forward'],
]);

/**
 * Clasifica una URL de un enlace. Solo `http:`/`https:` son web y `mailto:` correo; cualquier otra cosa
 * (`javascript:`, `file:`, `data:`, `vbscript:`, o sin protocolo válido) se bloquea. El protocolo lo
 * interpreta el parser de URL, así que las mayúsculas y los espacios no cambian el resultado.
 */
export function classifyUrl(url: string): 'web' | 'mail' | 'blocked' {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return 'blocked';
  }
  if (WEB_PROTOCOLS.has(protocol)) return 'web';
  if (protocol === 'mailto:') return 'mail';
  return 'blocked';
}

/** Objeto de anotación de pdf.js con solo los campos que interesan para clasificar el enlace. */
export interface LinkAnnotationFields {
  readonly url?: unknown;
  readonly unsafeUrl?: unknown;
  readonly dest?: unknown;
  readonly action?: unknown;
}

/**
 * Destino de un enlace a partir de sus campos. Orden: `url` (si es segura, externo; si no, bloqueado),
 * `unsafeUrl` sin `url` (bloqueado), `dest` (interno), `action` con nombre conocido (acción); el resto, bloqueado.
 */
export function linkTargetFromAnnotation(a: LinkAnnotationFields): LinkTarget {
  if (typeof a.url === 'string') {
    return classifyUrl(a.url) === 'blocked'
      ? { kind: 'blocked', reason: 'unsafe-url' }
      : { kind: 'external', url: a.url };
  }
  if (a.unsafeUrl !== undefined && a.unsafeUrl !== null) return { kind: 'blocked', reason: 'unsafe-url' };

  if (typeof a.dest === 'string' || Array.isArray(a.dest)) {
    return { kind: 'internal', dest: a.dest as PdfDest };
  }

  const actionName = actionNameOf(a.action);
  const action = actionName === null ? undefined : NAMED_ACTIONS.get(actionName);
  if (action !== undefined) return { kind: 'action', action };

  return { kind: 'blocked', reason: 'unsupported' };
}

/** Nombre de una acción: pdf.js la da como cadena o como `{ name }`. */
function actionNameOf(action: unknown): string | null {
  if (typeof action === 'string') return action;
  if (typeof action === 'object' && action !== null && 'name' in action && typeof action.name === 'string') {
    return action.name;
  }
  return null;
}
