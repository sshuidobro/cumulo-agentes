import { create } from 'zustand';
import { createLogger } from '@suite/shared';
import type { LoadedPdf } from '../engine';
import type { RectPt } from '../core/annotations/model';
import type { CertificateInfo, SignatureStatus } from '../core/signature/digital';
import { centeredSignatureBox } from '../core/signature/digital/placement';
import { pdfError } from '../core/errors';
import { concatSource } from '../core/pdf/concat-source';
import { digitalSignMsg } from '../ui/messages-digital-signature';
import { nowIso } from './annotation-actions';
import { useViewer } from './viewer-store';
import { currentPassword } from './document-actions';
import { runDocOp } from './doc-ops';
import { beginJob, endJob, jobOptions } from './extract-actions';
import { isSwitchingTab, registerTabParticipant, type TabParticipant } from './tabs';
import { showNotice } from './notice';
import { buildCurrentDelta, writeDocument, type SaveResult } from './save-actions';
import { services } from './services';

const log = createLogger('digital-signature-actions');

/** Tamaño máximo del certificado que se acepta, en bytes (1 MiB). */
export const MAX_CERTIFICATE_BYTES = 1024 * 1024;

/** Filtro de «Elegir certificado…». */
export const CERTIFICATE_FILTERS = [{ name: 'Certificado', extensions: ['p12', 'pfx'] }] as const;

/**
 * Datos del formulario de firma. El certificado (`p12`) y su contraseña solo viven en memoria: se borran al cerrar el
 * diálogo y al terminar de firmar. Nunca van a preferencias ni a borradores.
 */
export interface SignForm {
  readonly p12: { readonly name: string; readonly bytes: Uint8Array } | null;
  readonly password: string;
  readonly info: CertificateInfo | null;
  readonly visible: boolean;
  readonly reason: string;
  readonly location: string;
}

/** Estado del diálogo «Firmar con certificado» y de la colocación del recuadro. `error`: mensaje para el diálogo. */
export interface SignDialogState {
  readonly open: boolean;
  readonly form: SignForm;
  readonly placing: boolean;
  readonly error: string | null;
}

const EMPTY_FORM: SignForm = { p12: null, password: '', info: null, visible: false, reason: '', location: '' };

const INITIAL_DIALOG: SignDialogState = { open: false, form: EMPTY_FORM, placing: false, error: null };

export const useSignDialog = create<SignDialogState>()(() => INITIAL_DIALOG);

/** Validación del documento: estado y firmas (`list`). Es por pestaña (participante `signatures`). */
export interface SignaturesState {
  readonly status: 'idle' | 'checking' | 'ready' | 'error';
  readonly list: readonly SignatureStatus[];
}

const INITIAL_SIGNATURES: SignaturesState = { status: 'idle', list: [] };

export const useSignatures = create<SignaturesState>()(() => INITIAL_SIGNATURES);

/** Cada comprobación lleva un número; una respuesta de otra generación (o de otro documento) se descarta. */
let generation = 0;

/** Quita del estado todo lo que es secreto: bytes del certificado y contraseña. Conserva la elección de firma. */
function clearSecrets(): void {
  const { form } = useSignDialog.getState();
  useSignDialog.setState({ form: { ...form, p12: null, password: '', info: null } });
}

/** Abre el diálogo con un formulario vacío. No hace nada sin documento listo; con cifrado avisa antes de pedir nada. */
export function openSignDialog(): void {
  const { status, file, encrypted } = useViewer.getState();
  if (status !== 'ready' || file === null) return;
  if (encrypted) {
    showNotice(pdfError('sign-encrypted').message);
    return;
  }
  if (useSignDialog.getState().open || useSignDialog.getState().placing) return;
  const keep = useSignDialog.getState().form;
  useSignDialog.setState({ open: true, form: { ...EMPTY_FORM, visible: keep.visible, reason: keep.reason, location: keep.location }, error: null });
}

/** Cierra el diálogo y borra el certificado y su contraseña de la memoria. */
export function closeSignDialog(): void {
  useSignDialog.setState({ open: false, error: null });
  clearSecrets();
}

/** Cambia motivo, lugar o la elección visible/invisible. El certificado no se cambia por aquí. */
export function setSignField(patch: Partial<Pick<SignForm, 'visible' | 'reason' | 'location'>>): void {
  const { form } = useSignDialog.getState();
  useSignDialog.setState({ form: { ...form, ...patch } });
}

/**
 * «Elegir certificado…»: lee un .p12/.pfx (1 MiB como máximo). Cambiar de certificado borra la contraseña y los datos
 * del anterior. Cancelar el selector no cambia nada.
 */
export async function chooseCertificate(): Promise<void> {
  const picked = await services().platform.importFile(CERTIFICATE_FILTERS, MAX_CERTIFICATE_BYTES);
  if (!picked.ok) {
    log.warn('importFile', picked.error.code);
    useSignDialog.setState({
      error: picked.error.code === 'out-of-range' ? digitalSignMsg.certificateTooLarge : picked.error.message,
    });
    return;
  }
  if (picked.value === null) return;
  const { name, bytes } = picked.value;
  const { form } = useSignDialog.getState();
  useSignDialog.setState({
    form: { ...form, p12: { name, bytes }, password: '', info: null },
    error: null,
  });
}

/**
 * «Desbloquear»: abre el certificado con `password` (operación `p12-info` del Worker). Si sirve, guarda la contraseña
 * y los datos del certificado; si no, deja el mensaje en el diálogo. Devuelve si se ha desbloqueado.
 */
export async function unlockCertificate(password: string): Promise<boolean> {
  const { form } = useSignDialog.getState();
  if (form.p12 === null) return false;
  const result = await runDocOp<CertificateInfo>('p12-info', { p12: form.p12.bytes, password }, []);
  if (!result.ok) {
    log.warn('p12-info', result.error.code);
    useSignDialog.setState((state) => ({
      form: { ...state.form, password: '', info: null },
      error: digitalSignMsg.unlockFailed,
    }));
    return false;
  }
  useSignDialog.setState((state) => ({
    form: { ...state.form, password, info: result.value },
    error: null,
  }));
  return true;
}

/** «Firmar» con firma invisible: cierra el diálogo y firma la página actual sin recuadro. */
export function signInvisible(): Promise<SaveResult> {
  const { currentPage } = useViewer.getState();
  useSignDialog.setState({ open: false, error: null });
  return signDocument(currentPage, null);
}

/** «Colocar y firmar»: cierra el diálogo y activa el arrastre del recuadro sobre las páginas. */
export function startPlacing(): void {
  const { form } = useSignDialog.getState();
  if (form.p12 === null || form.info === null) return;
  useSignDialog.setState({ open: false, placing: true, error: null });
}

/** Escape durante la colocación: no se firma y se borra el certificado de la memoria. */
export function cancelPlacing(): void {
  if (!useSignDialog.getState().placing) return;
  useSignDialog.setState({ placing: false, error: null });
  clearSecrets();
}

/** Intro durante la colocación: firma en el centro de la página actual, con el tamaño de la firma por teclado. */
export function signAtCurrentPageCenter(): Promise<SaveResult> | null {
  const { dims, currentPage } = useViewer.getState();
  if (dims === null || currentPage >= dims.count) return null;
  const rect: RectPt = centeredSignatureBox(dims.width(currentPage), dims.height(currentPage));
  return signDocument(currentPage, rect);
}

/** Fallo de la firma: se avisa y no se toca el fichero. */
function fail(message: string): SaveResult {
  showNotice(message);
  return 'failed';
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Firma el documento abierto (PAdES B-B, PDF-066) con el certificado del diálogo. `rect` null = firma invisible.
 * Los cambios sin guardar van delante, como en OCR. Al terminar, con cualquier resultado, borra el certificado y su
 * contraseña de la memoria. Nunca lanza.
 */
export async function signDocument(pageIndex: number, rect: RectPt | null): Promise<SaveResult> {
  const { status, file, pdf, encrypted } = useViewer.getState();
  const { form } = useSignDialog.getState();
  useSignDialog.setState({ placing: false });
  if (status !== 'ready' || file === null || pdf === null) {
    clearSecrets();
    return 'nothing';
  }
  if (encrypted) {
    clearSecrets();
    return fail(pdfError('sign-encrypted').message);
  }
  if (form.p12 === null || form.info === null) {
    clearSecrets();
    return 'failed';
  }
  const controller = beginJob(digitalSignMsg.signing);
  if (controller === null) {
    clearSecrets();
    return 'cancelled';
  }
  try {
    const built = await buildCurrentDelta(file);
    if (!built.ok) return fail(built.error.message);
    const prefix = built.value ?? new Uint8Array(0);
    const result = await runDocOp<{ readonly delta: Uint8Array }>(
      'sign',
      {
        password: currentPassword(),
        p12: form.p12.bytes,
        p12Password: form.password,
        pageIndex,
        rect,
        reason: form.reason,
        location: form.location,
        now: nowIso(),
      },
      [concatSource(file.source, prefix)],
      jobOptions(controller),
    );
    if (controller.signal.aborted) return 'cancelled';
    endJob(controller);
    if (!result.ok) return fail(result.error.message);
    const saved = await writeDocument({ kind: 'append', delta: concatBytes(prefix, result.value.delta) });
    if (saved === 'saved' || saved === 'downloaded') showNotice(digitalSignMsg.signed);
    return saved;
  } finally {
    endJob(controller);
    clearSecrets();
  }
}

/** Validación de las firmas del documento `pdf` (el abierto). Sin red ni confianza: identidad no verificada. */
export async function refreshSignatures(): Promise<void> {
  const { status, file, pdf } = useViewer.getState();
  if (status !== 'ready' || file === null || pdf === null) return;
  const token = ++generation;
  useSignatures.setState({ status: 'checking' });
  const result = await runDocOp<readonly SignatureStatus[]>(
    'verify-signatures',
    { password: currentPassword() },
    [file.source],
  );
  // Otra comprobación, una pestaña suspendida o un documento distinto: el resultado ya no es de este estado.
  if (token !== generation || useViewer.getState().pdf !== pdf) return;
  if (!result.ok) {
    log.warn('verify-signatures', result.error.code);
    useSignatures.setState({ status: 'error', list: [] });
    return;
  }
  useSignatures.setState({ status: 'ready', list: result.value });
}

/**
 * ¿Tiene el documento firmas? pdf.js `getSignatures` solo devuelve las firmas con valor (campos `/FT /Sig` firmados).
 * `getFieldObjects` no sirve: no lista los campos de firma (devuelve vacío para un PDF firmado).
 */
async function hasSignedSignatures(pdf: LoadedPdf): Promise<boolean> {
  const signatures = await pdf.doc.getSignatures().catch(() => null);
  return signatures !== null && signatures.length > 0;
}

/** Al quedar listo un documento con firmas, lo valida. Sin firmas, el estado queda en reposo. */
async function startSignatureCheck(pdf: LoadedPdf): Promise<void> {
  const token = ++generation;
  if (!(await hasSignedSignatures(pdf))) return;
  if (token !== generation || useViewer.getState().pdf !== pdf) return;
  await refreshSignatures();
}

/** Al cambiar el documento (no al cambiar de pestaña, que lo gestiona el participante) se valida o se limpia. */
export function onViewerDocumentChanged(pdf: LoadedPdf | null, switching: boolean): void {
  if (switching) return;
  generation++;
  if (pdf === null) {
    useSignatures.setState(INITIAL_SIGNATURES);
    return;
  }
  useSignatures.setState(INITIAL_SIGNATURES);
  void startSignatureCheck(pdf);
}

interface SignaturesSnapshot {
  readonly status: SignaturesState['status'];
  readonly list: readonly SignatureStatus[];
}

const signaturesParticipant: TabParticipant<SignaturesSnapshot> = {
  id: 'signatures',
  order: 42,
  suspend(): SignaturesSnapshot {
    const { status, list } = useSignatures.getState();
    generation++;
    useSignatures.setState(INITIAL_SIGNATURES);
    return { status, list };
  },
  resume(snapshot: SignaturesSnapshot): void {
    useSignatures.setState({ status: snapshot.status, list: snapshot.list });
    // Si la comprobación estaba en curso al suspender, su resultado se descartó: se vuelve a lanzar.
    if (snapshot.status === 'checking') void refreshSignatures();
  },
  dispose(): Promise<void> {
    generation++;
    useSignatures.setState(INITIAL_SIGNATURES);
    return Promise.resolve();
  },
};

/** Da de alta las firmas en el registro de pestañas y vigila el documento. Llamar una vez al arrancar. */
export function registerSignatureParticipant(): void {
  registerTabParticipant(signaturesParticipant);
  useViewer.subscribe((next, prev) => {
    if (next.pdf !== prev.pdf) onViewerDocumentChanged(next.pdf, isSwitchingTab());
  });
}
