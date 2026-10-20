import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { memorySource } from "@suite/platform";
import { err, ok, type AppError, type Result } from "@suite/shared";
import { pdfError } from "../../src/core/errors";
import type {
  DocOpsClient,
  RunOptions,
  SourceInput,
} from "../../src/core/doc-ops/client";
import { ALL_PERMISSIONS } from "../../src/core/permissions";
import { openForSave } from "../../src/core/pdf";
import {
  cancelDocOp,
  closeExtractDialogs,
  extractPages,
  openExtractDialog,
  openSplitDialog,
  splitDocument,
  useDocOpJob,
  useExtractDialog,
} from "../../src/state/extract-actions";
import { inProcessDocOps, setDocOpsRunner } from "../../src/state/doc-ops";
import { useViewer } from "../../src/state/viewer-store";
import { organizeMsg } from "../../src/ui/messages-organize";
import { openedFile } from "../helpers/fake-platform";
import { openFixture, setupSaveHarness } from "../helpers/save-harness";

const h = setupSaveHarness();

/**
 * Ejecutor en el mismo hilo. Para la operación `target`, `act` decide: `null` deja pasar la operación; un resultado
 * la sustituye (sin ejecutarla).
 */
function runnerFor(
  target: string,
  act: (
    opts: RunOptions | undefined,
  ) => Result<unknown, AppError> | "cancel-then-run" | null,
): DocOpsClient {
  const inner = inProcessDocOps();
  return {
    async run<T>(
      op: string,
      args: unknown,
      sources: readonly SourceInput[],
      opts?: RunOptions,
    ): Promise<Result<T, AppError>> {
      if (op === target) {
        const decision = act(opts);
        if (decision === "cancel-then-run") cancelDocOp();
        else if (decision !== null) return decision as Result<T, AppError>;
      }
      return inner.run<T>(op, args, sources, opts);
    },
    dispose: () => inner.dispose(),
  };
}

/** Texto de la última notificación visible. */
function notice(): string | undefined {
  return useViewer.getState().notice?.text;
}

beforeEach(() => {
  useExtractDialog.setState({
    open: null,
    extract: { pages: "current", range: "" },
    split: { mode: "pages", every: 1 },
  });
  useDocOpJob.setState({ label: null, done: 0, total: 0 });
});

afterEach(() => {
  setDocOpsRunner(null);
  useViewer.setState({ notice: null, permissions: ALL_PERMISSIONS });
  useExtractDialog.setState({ open: null });
  useDocOpJob.setState({ label: null, done: 0, total: 0 });
});

describe("extraer páginas (PDF-127)", () => {
  it("guarda las páginas pedidas como PDF nuevo con el nombre propuesto y avisa", async () => {
    await openFixture();
    const saved = openedFile(
      "basic-5-paginas-3-4.pdf",
      memorySource(new Uint8Array(0)),
    );
    h.saveAs.mockResolvedValueOnce(ok({ kind: "saved", file: saved }));

    const result = await extractPages([2, 3]);

    expect(result).toBe("saved");
    expect(h.saveAs).toHaveBeenCalledTimes(1);
    const [name, , data] = h.saveAs.mock.calls[0] as [
      string,
      unknown,
      { kind: string; bytes: Uint8Array },
    ];
    expect(name).toBe("basic-5-paginas-3-4.pdf");
    expect(data.kind).toBe("bytes");
    const reader = await openForSave(memorySource(data.bytes), undefined);
    expect(reader.ok ? await reader.value.pageCount() : -1).toBe(2);
    expect(notice()).toBe(organizeMsg.extracted("basic-5-paginas-3-4.pdf"));
  });

  it("sin permiso de copia no hace nada y avisa", async () => {
    await openFixture();
    useViewer.setState({ permissions: { ...ALL_PERMISSIONS, copy: false } });

    expect(await extractPages([0])).toBe("failed");
    expect(h.saveAs).not.toHaveBeenCalled();
    expect(notice()).toBe(organizeMsg.extractBlocked);
  });

  it("cancelar a mitad no guarda nada", async () => {
    await openFixture();
    setDocOpsRunner(runnerFor("extract", () => "cancel-then-run"));

    expect(await extractPages([0, 1])).toBe("cancelled");
    expect(h.saveAs).not.toHaveBeenCalled();
    expect(useDocOpJob.getState().label).toBeNull();
  });

  it("un error de la operación se muestra tal cual y no guarda", async () => {
    await openFixture();
    setDocOpsRunner(
      runnerFor("extract", () => err(pdfError("organize-invalid"))),
    );

    expect(await extractPages([0])).toBe("failed");
    expect(h.saveAs).not.toHaveBeenCalled();
    expect(notice()).toBe(pdfError("organize-invalid").message);
  });
});

describe("dividir documento (PDF-127)", () => {
  it("divide cada 2 páginas: un ZIP con tres partes con el nombre esperado", async () => {
    await openFixture();

    const result = await splitDocument({ mode: "pages", every: 2 });

    expect(result).toBe("saved");
    const exported = vi.mocked(h.platform.exportFile);
    expect(exported).toHaveBeenCalledTimes(1);
    const [name, filters, bytes] = exported.mock.calls[0] as [
      string,
      unknown,
      Uint8Array,
    ];
    expect(name).toBe("basic-5-partes.zip");
    expect(filters).toEqual([{ name: "ZIP", extensions: ["zip"] }]);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      "basic-5-parte-01.pdf",
      "basic-5-parte-02.pdf",
      "basic-5-parte-03.pdf",
    ]);
    expect(notice()).toBe(organizeMsg.splitDone(3));
  });

  it("por marcadores sin marcadores en el PDF: error de la operación, no se guarda", async () => {
    await openFixture();

    expect(await splitDocument({ mode: "bookmarks" })).toBe("failed");
    expect(vi.mocked(h.platform.exportFile)).not.toHaveBeenCalled();
    expect(notice()).toBe(pdfError("split-no-bookmarks").message);
  });

  it("cancelar a mitad no guarda el ZIP", async () => {
    await openFixture();
    setDocOpsRunner(runnerFor("split", () => "cancel-then-run"));

    expect(await splitDocument({ mode: "pages", every: 1 })).toBe("cancelled");
    expect(vi.mocked(h.platform.exportFile)).not.toHaveBeenCalled();
  });
});

describe("diálogos (PDF-127)", () => {
  it("«Extraer» abre el diálogo con la página actual y se cierra", async () => {
    await openFixture();
    openExtractDialog();
    expect(useExtractDialog.getState().open).toBe("extract");
    expect(useExtractDialog.getState().extract).toEqual({
      pages: "current",
      range: "",
    });
    closeExtractDialogs();
    expect(useExtractDialog.getState().open).toBeNull();
  });

  it("sin permiso de copia, «Dividir» no abre el diálogo y avisa", async () => {
    await openFixture();
    useViewer.setState({ permissions: { ...ALL_PERMISSIONS, copy: false } });
    openSplitDialog();
    expect(useExtractDialog.getState().open).toBeNull();
    expect(notice()).toBe(organizeMsg.extractBlocked);
  });

  it("sin documento no abre nada", () => {
    openExtractDialog();
    expect(useExtractDialog.getState().open).toBeNull();
  });
});
