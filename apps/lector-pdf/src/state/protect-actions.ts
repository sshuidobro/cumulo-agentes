import { create } from 'zustand';
import type { OpenedFile } from '@suite/platform';
import type { PermissionChoice } from '../core/pdf/crypto';
import type { PDFDocumentProxy } from '../engine';
import { securityMsg } from '../ui/messages-security';
import { nowIso } from './annotation-actions';
import { askChoice } from './choice';
import { currentPassword } from './document-actions';
import { runDocOp } from './doc-ops';
import { beginJob, endJob, jobOptions, sourceWithChanges } from './extract-actions';
import { askPassword } from './password-prompt';
import { showNotice } from './notice';
import { writeDocument, type SaveResult } from './save-actions';
import { useViewer } from './viewer-store';

/** Qué puede hacer el lector con los cambios de contenido (la opción «Cambios permitidos»). */
export type ChangesAllowed = 'none' | 'assemble' | 'forms' | 'comments' | 'all-but-extract';

/** Formulario de «Proteger con contraseña…» (PDF-132). */
export interface ProtectForm {
  readonly requireOpen: boolean;
  readonly openPassword: string;
  readonly openConfirm: string;
  readonly restrict: boolean;
  readonly ownerPassword: string;
  readonly ownerConfirm: string;
  readonly print: 'none' | 'low' | 'high';
  readonly changes: ChangesAllowed;
  readonly copy: boolean;
}

interface ProtectDialogState {
  /** Diálogo abierto. */
  readonly open: boolean;
  readonly form: ProtectForm;
}

/** Valores iniciales: sin protección y, si se activan las restricciones, todo lo permitido (como `ALL_ALLOWED`). */
const DEFAULT_FORM: ProtectForm = {
  requireOpen: false,
  openPassword: '',
  openConfirm: '',
  restrict: false,
  ownerPassword: '',
  ownerConfirm: '',
  print: 'high',
  changes: 'all-but-extract',
  copy: true,
};

/** Diálogo «Proteger con contraseña» (lo pinta `ui/security/ProtectDialog`). */
export const useProtectDialog = create<ProtectDialogState>()(() => ({ open: false, form: DEFAULT_FORM }));

/** Abre el diálogo con un documento listo. `form` permite reabrirlo con lo escrito tras un fallo. */
export function openProtectDialog(form: ProtectForm = DEFAULT_FORM): void {
  const { status, file } = useViewer.getState();
  if (status !== 'ready' || file === null) return;
  useProtectDialog.setState({ open: true, form });
}

export function closeProtectDialog(): void {
  useProtectDialog.setState({ open: false });
}

export function setProtectForm(patch: Partial<ProtectForm>): void {
  useProtectDialog.setState((state) => ({ form: { ...state.form, ...patch } }));
}

/**
 * Permisos que se conceden al abrir con la contraseña de usuario. Sin restricciones, todo permitido: la misma
 * tabla que `ALL_ALLOWED` de `core/pdf/crypto` (no se importa aquí para no añadir el cifrado al arranque).
 */
export function toPermissionChoice(f: ProtectForm): PermissionChoice {
  if (!f.restrict) {
    return { print: 'high', modify: true, copy: true, annotate: true, fillForms: true, assemble: true };
  }
  const changes = f.changes;
  return {
    print: f.print,
    copy: f.copy,
    modify: changes === 'all-but-extract',
    annotate: changes === 'comments' || changes === 'all-but-extract',
    fillForms: changes === 'forms' || changes === 'comments' || changes === 'all-but-extract',
    assemble: changes === 'assemble' || changes === 'all-but-extract',
  };
}

/** Primer problema del formulario, en español, o `null` si se puede proteger. */
export function protectFormError(f: ProtectForm): string | null {
  if (!f.requireOpen && !f.restrict) return securityMsg.chooseOne;
  if (f.requireOpen && f.openPassword === '') return securityMsg.passwordRequired;
  if (f.restrict && f.ownerPassword === '') return securityMsg.passwordRequired;
  if (f.requireOpen && f.openPassword !== f.openConfirm) return securityMsg.passwordMismatch;
  if (f.restrict && f.ownerPassword !== f.ownerConfirm) return securityMsg.passwordMismatch;
  if (f.requireOpen && f.restrict && f.openPassword === f.ownerPassword) return securityMsg.passwordsEqual;
  return null;
}

/** Errores de la operación o de la escritura: se avisa y el fichero no se toca. */
function fail(message: string): SaveResult {
  showNotice(message);
  return 'failed';
}

/** Sustituye el fichero abierto por `bytes` y lo reabre con `password`. El aviso solo si se guardó en sitio o copia. */
async function replaceWith(bytes: Uint8Array, password: string | null, notice: string): Promise<SaveResult> {
  const saved = await writeDocument({ kind: 'replace', bytes, password });
  if (saved === 'saved') showNotice(notice);
  return saved;
}

/** Firmas digitales ya firmadas (pdf.js `getSignatures`: solo las que tienen valor). Sin firmas o con error, `false`. */
async function hasSignedSignatures(doc: PDFDocumentProxy): Promise<boolean> {
  const signatures = await doc.getSignatures().catch(() => null);
  return signatures !== null && signatures.length > 0;
}

/**
 * Protege el documento abierto con AES-256 (PDF-131). Con cambios sin guardar, se incluyen. Si tiene firmas, pide
 * confirmación. Nunca lanza.
 */
export async function protectDocument(f: ProtectForm): Promise<SaveResult> {
  const { file, status, pdf } = useViewer.getState();
  if (status !== 'ready' || file === null || pdf === null) return 'nothing';
  if (await hasSignedSignatures(pdf.doc)) {
    const answer = await askChoice({
      title: securityMsg.protectTitle,
      message: securityMsg.signedWarning,
      options: [
        { label: securityMsg.signedContinue, value: 'continue' },
        { label: securityMsg.cancel, value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (answer === 'cancel') return 'cancelled';
  }
  const controller = beginJob(securityMsg.protectTitle, securityMsg.progressProtect);
  if (controller === null) return 'cancelled';
  try {
    const { source, unsaved } = await sourceWithChanges(file);
    if (unsaved) return fail(securityMsg.unsavedBlocked);
    const userPassword = f.requireOpen ? f.openPassword : '';
    const result = await runDocOp<{ readonly bytes: Uint8Array }>(
      'protect',
      {
        password: currentPassword(),
        userPassword,
        ownerPassword: f.restrict ? f.ownerPassword : '',
        permissions: toPermissionChoice(f),
        now: nowIso(),
      },
      [source],
      jobOptions(controller),
    );
    if (controller.signal.aborted) return 'cancelled';
    endJob(controller);
    if (!result.ok) return fail(result.error.message);
    return replaceWith(result.value.bytes, userPassword === '' ? null : userPassword, securityMsg.protectedNotice);
  } finally {
    endJob(controller);
  }
}

/** Resultado de un intento de «Quitar protección»: el documento sin cifrar, la contraseña de permisos o el final. */
type UnprotectAttempt =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'owner'; readonly wrong: boolean }
  | { readonly kind: 'stop'; readonly result: SaveResult };

async function unprotectOnce(file: OpenedFile, password: string | null): Promise<UnprotectAttempt> {
  const controller = beginJob(securityMsg.unprotectTitle);
  if (controller === null) return { kind: 'stop', result: 'cancelled' };
  try {
    const { source, unsaved } = await sourceWithChanges(file);
    if (unsaved) return { kind: 'stop', result: fail(securityMsg.unsavedBlocked) };
    const result = await runDocOp<{ readonly bytes: Uint8Array }>(
      'unprotect',
      { password, now: nowIso() },
      [source],
      jobOptions(controller),
    );
    if (controller.signal.aborted) return { kind: 'stop', result: 'cancelled' };
    if (result.ok) return { kind: 'bytes', bytes: result.value.bytes };
    if (result.error.code === 'owner-password-required') return { kind: 'owner', wrong: false };
    if (result.error.code === 'save-wrong-password') return { kind: 'owner', wrong: true };
    return { kind: 'stop', result: fail(result.error.message) };
  } finally {
    endJob(controller);
  }
}

/**
 * Quita la protección del documento abierto (PDF-131). Si hace falta la contraseña de permisos, la pide y reintenta.
 * Con cambios sin guardar, se incluyen. Nunca lanza.
 */
export async function removeProtection(): Promise<SaveResult> {
  const { file, status } = useViewer.getState();
  if (status !== 'ready' || file === null) return 'nothing';
  let password = currentPassword();
  for (;;) {
    const attempt = await unprotectOnce(file, password);
    if (attempt.kind === 'bytes') return replaceWith(attempt.bytes, null, securityMsg.unprotectedNotice);
    if (attempt.kind === 'stop') return attempt.result;
    const typed = await askPassword(file.name, attempt.wrong, securityMsg.ownerPasswordPrompt(file.name));
    if (typed === null) return 'cancelled';
    password = typed;
  }
}

/**
 * Botón «Proteger» del diálogo: cierra el diálogo y protege. Si no se guarda (cancelado o con error), el diálogo
 * vuelve con lo escrito.
 */
export async function submitProtectDialog(): Promise<void> {
  const snapshot = useProtectDialog.getState().form;
  closeProtectDialog();
  const outcome = await protectDocument(snapshot);
  if (outcome === 'failed' || outcome === 'cancelled') openProtectDialog(snapshot);
}
