import { create } from "zustand";
import type { ByteSource, FileFilter, OpenedFile } from "@suite/platform";
import { createLogger } from "@suite/shared";
import { concatSource } from "../core/pdf/concat-source";
import { exportBaseName } from "../core/export/plan";
import {
  extractFileName,
  splitZipName,
  type SPLIT_SIZES_MB,
  type SplitMode,
} from "../core/organize/split-names";
import type { RunOptions } from "../core/doc-ops/client";
import { organizeMsg } from "../ui/messages-organize";
import { nowIso } from "./annotation-actions";
import { runDocOp } from "./doc-ops";
import { currentPassword, PDF_FILTERS } from "./document-actions";
import { showNotice } from "./notice";
import { buildCurrentDelta } from "./save-actions";
import { services } from "./services";
import { useViewer } from "./viewer-store";

const log = createLogger("extract-actions");

const BYTES_PER_MB = 1024 * 1024;

const ZIP_FILTERS: readonly FileFilter[] = [
  { name: "ZIP", extensions: ["zip"] },
];

/** Resultado de extraer o dividir: lo que devuelve la plataforma, o `failed` si no se pudo. */
export type DocOpResult = "saved" | "downloaded" | "cancelled" | "failed";

/** Formulario de «Extraer páginas…». `current` = la página que se ve; `range` = texto como «3-7, 10». */
export interface ExtractForm {
  readonly pages: "current" | "range";
  readonly range: string;
}

/** Formulario de «Dividir documento…». */
export type SplitForm =
  | { readonly mode: "pages"; readonly every: number }
  | { readonly mode: "bookmarks" }
  | { readonly mode: "size"; readonly mb: (typeof SPLIT_SIZES_MB)[number] };

interface ExtractDialogState {
  /** Diálogo abierto, o `null`. */
  readonly open: "extract" | "split" | null;
  readonly extract: ExtractForm;
  readonly split: SplitForm;
}

const DEFAULT_EXTRACT: ExtractForm = { pages: "current", range: "" };
const DEFAULT_SPLIT: SplitForm = { mode: "pages", every: 1 };

/** Diálogos «Extraer» y «Dividir» (los pinta `ui/organize/ExtractDialog` y `SplitDialog`). */
export const useExtractDialog = create<ExtractDialogState>()(() => ({
  open: null,
  extract: DEFAULT_EXTRACT,
  split: DEFAULT_SPLIT,
}));

/** Texto de progreso: recibe la posición actual (empieza en 1) y el total. */
export type JobProgressText = (current: number, total: number) => string;

interface DocOpJobState {
  /** Título de la operación en curso, o `null` si no hay ninguna. */
  readonly label: string | null;
  readonly done: number;
  readonly total: number;
  /** Texto del progreso; `null` = «Copiando páginas…» (por defecto). */
  readonly progressText: JobProgressText | null;
}

const IDLE_JOB: DocOpJobState = { label: null, done: 0, total: 0, progressText: null };

/** Progreso de la operación de documento en curso (extraer o dividir). Lo lee `DocOpJobProgress`. */
export const useDocOpJob = create<DocOpJobState>()(() => IDLE_JOB);

/** Abre «Extraer páginas…» si hay documento y se puede copiar. */
export function openExtractDialog(): void {
  if (!canStartFromDocument()) return;
  useExtractDialog.setState({ open: "extract", extract: DEFAULT_EXTRACT });
}

/** Abre «Dividir documento…» si hay documento y se puede copiar. */
export function openSplitDialog(): void {
  if (!canStartFromDocument()) return;
  useExtractDialog.setState({ open: "split", split: DEFAULT_SPLIT });
}

export function closeExtractDialogs(): void {
  useExtractDialog.setState({ open: null });
}

export function setExtractForm(patch: Partial<ExtractForm>): void {
  useExtractDialog.setState((state) => ({
    extract: { ...state.extract, ...patch },
  }));
}

export function setSplitForm(next: SplitForm): void {
  useExtractDialog.setState({ split: next });
}

/** Con documento listo y permiso de copia. Sin permiso avisa; sin documento no hace nada. */
function canStartFromDocument(): boolean {
  const { status, pdf, permissions } = useViewer.getState();
  if (status !== "ready" || pdf === null) return false;
  if (!permissions.copy) {
    showNotice(organizeMsg.extractBlocked);
    return false;
  }
  return true;
}

/** Operación en curso. Solo puede haber una. */
let activeController: AbortController | null = null;

/** Reserva el progreso para una operación nueva; `null` si ya hay otra en curso. */
export function beginJob(label: string, progressText: JobProgressText | null = null): AbortController | null {
  if (activeController !== null) return null;
  const controller = new AbortController();
  activeController = controller;
  useDocOpJob.setState({ label, done: 0, total: 0, progressText });
  return controller;
}

/** Libera el progreso de `controller` si sigue siendo la operación activa. */
export function endJob(controller: AbortController): void {
  if (activeController !== controller) return;
  activeController = null;
  useDocOpJob.setState(IDLE_JOB);
}

/** Cancela la operación en curso: no se guarda nada. */
export function cancelDocOp(): void {
  const controller = activeController;
  if (controller === null) return;
  controller.abort();
  endJob(controller);
}

/**
 * Fuente con los cambios sin guardar (anotaciones y formularios) al final. Si no se pueden calcular, se usa el
 * original y se devuelve `unsaved: true` para avisar.
 */
export async function sourceWithChanges(
  file: OpenedFile,
): Promise<{ readonly source: ByteSource; readonly unsaved: boolean }> {
  const built = await buildCurrentDelta(file);
  if (!built.ok) {
    log.warn("buildCurrentDelta", built.error.code);
    return { source: file.source, unsaved: true };
  }
  if (built.value === null) return { source: file.source, unsaved: false };
  return { source: concatSource(file.source, built.value), unsaved: false };
}

/** Aviso final: el resultado y, si hubo cambios que no se incluyeron, la advertencia antes. */
function notice(result: string, unsaved: boolean): string {
  return unsaved ? `${organizeMsg.unsavedNotIncluded} ${result}` : result;
}

/**
 * Extrae las páginas (índices 0-based, en ese orden) a un PDF nuevo sin contraseña y lo guarda con el diálogo del
 * sistema. El documento abierto no cambia. Nunca lanza.
 */
export async function extractPages(
  pages: readonly number[],
): Promise<DocOpResult> {
  const { file, status, pdf } = useViewer.getState();
  if (status !== "ready" || file === null || pdf === null || pages.length === 0)
    return "failed";
  if (!canStartFromDocument()) return "failed";
  const controller = beginJob(organizeMsg.extractTitle);
  if (controller === null) return "failed";
  try {
    const { source, unsaved } = await sourceWithChanges(file);
    const base = exportBaseName(file.name);
    const result = await runDocOp<{ readonly bytes: Uint8Array }>(
      "extract",
      {
        password: currentPassword(),
        pages: [...pages],
        now: nowIso(),
        title: base,
      },
      [source],
      jobOptions(controller),
    );
    if (controller.signal.aborted) return "cancelled";
    endJob(controller);
    if (!result.ok) return fail(result.error.message);
    const name = extractFileName(base, pages);
    const outcome = await services().platform.saveAs(name, PDF_FILTERS, {
      kind: "bytes",
      bytes: result.value.bytes,
    });
    if (!outcome.ok) return fail(outcome.error.message);
    switch (outcome.value.kind) {
      case "cancelled":
        return "cancelled";
      case "saved":
        showNotice(
          notice(organizeMsg.extracted(outcome.value.file.name), unsaved),
        );
        return "saved";
      case "downloaded":
        showNotice(notice(organizeMsg.extracted(outcome.value.name), unsaved));
        return "downloaded";
    }
  } finally {
    endJob(controller);
  }
}

/**
 * Divide el documento en partes y guarda un ZIP con ellas (diálogo del sistema). Nunca lanza.
 */
export async function splitDocument(form: SplitForm): Promise<DocOpResult> {
  const { file, status, pdf } = useViewer.getState();
  if (status !== "ready" || file === null || pdf === null) return "failed";
  if (!canStartFromDocument()) return "failed";
  const controller = beginJob(organizeMsg.splitTitle);
  if (controller === null) return "failed";
  try {
    const { source, unsaved } = await sourceWithChanges(file);
    const base = exportBaseName(file.name);
    const result = await runDocOp<{
      readonly zip: Uint8Array;
      readonly parts: number;
      readonly oversized: number;
    }>(
      "split",
      {
        password: currentPassword(),
        mode: splitModeOf(form),
        baseName: base,
        now: nowIso(),
      },
      [source],
      jobOptions(controller),
    );
    if (controller.signal.aborted) return "cancelled";
    endJob(controller);
    if (!result.ok) return fail(result.error.message);
    const outcome = await services().platform.exportFile(
      splitZipName(base),
      ZIP_FILTERS,
      result.value.zip,
    );
    if (!outcome.ok) return fail(outcome.error.message);
    if (outcome.value === "cancelled") return "cancelled";
    const { parts, oversized } = result.value;
    const summary =
      oversized > 0
        ? `${organizeMsg.splitDone(parts)} ${organizeMsg.oversized(oversized)}`
        : organizeMsg.splitDone(parts);
    showNotice(notice(summary, unsaved));
    return outcome.value;
  } finally {
    endJob(controller);
  }
}

/** Error de una operación o de la plataforma: se avisa y no se guarda nada más. */
function fail(message: string): DocOpResult {
  showNotice(message);
  return "failed";
}

export function jobOptions(controller: AbortController): RunOptions {
  return {
    signal: controller.signal,
    onProgress: (done: number, total: number) => {
      if (activeController === controller)
        useDocOpJob.setState({ done, total });
    },
  };
}

/** Modo de reparto del formulario, en el formato que espera la operación `split`. */
function splitModeOf(form: SplitForm): SplitMode {
  switch (form.mode) {
    case "pages":
      return { kind: "pages", every: form.every };
    case "bookmarks":
      return { kind: "bookmarks" };
    case "size":
      return { kind: "size", maxBytes: form.mb * BYTES_PER_MB };
  }
}
