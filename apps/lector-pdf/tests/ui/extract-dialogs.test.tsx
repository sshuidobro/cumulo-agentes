// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memorySource, type OpenedFile, type Platform } from "@suite/platform";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedPdf } from "../../src/engine";
import { readCipher } from "../../src/engine";
import {
  extractPages,
  splitDocument,
  useDocOpJob,
  useExtractDialog,
} from "../../src/state/extract-actions";
import { initServices } from "../../src/state/services";
import { initialViewerState, useViewer } from "../../src/state/viewer-store";
import { ExtractDialog } from "../../src/ui/organize/ExtractDialog";
import { SplitDialog } from "../../src/ui/organize/SplitDialog";
import { DocOpProgress } from "../../src/ui/kit/DocOpProgress";
import { organizeMsg } from "../../src/ui/messages-organize";
import { createFakePlatform } from "../helpers/fake-platform";

vi.mock("../../src/engine", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readCipher: vi.fn(async () => "none"),
}));

vi.mock("../../src/state/extract-actions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  extractPages: vi.fn(async () => "saved"),
  splitDocument: vi.fn(async () => "saved"),
}));

const PAGES = 5;

let platform: Platform;

beforeEach(() => {
  platform = createFakePlatform();
  initServices({ platform, assetBaseUrl: "/" });
  const file: OpenedFile = {
    token: "fake",
    name: "informe.pdf",
    path: null,
    size: 10,
    lastModified: null,
    canSaveInPlace: false,
    source: memorySource(new Uint8Array(0)),
  };
  const pdf = {
    doc: {},
    numPages: PAGES,
    fingerprint: "fake",
  } as unknown as LoadedPdf;
  useViewer.setState({
    ...initialViewerState,
    status: "ready",
    file,
    pdf,
    currentPage: 1,
    outline: null,
  });
  useExtractDialog.setState({
    open: "extract",
    extract: { pages: "current", range: "" },
    split: { mode: "pages", every: 1 },
  });
  useDocOpJob.setState({ label: null, done: 0, total: 0 });
  vi.mocked(readCipher).mockResolvedValue("none");
});

afterEach(() => {
  vi.clearAllMocks();
  useViewer.setState(initialViewerState);
  useExtractDialog.setState({ open: null });
});

describe("ExtractDialog (PDF-127)", () => {
  it("propone la página actual, el nombre del PDF nuevo y enfoca el primer control", () => {
    render(<ExtractDialog />);
    expect(
      screen.getByRole("radio", { name: organizeMsg.extractCurrent(2) }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: organizeMsg.extractCurrent(2) }),
    ).toHaveFocus();
    expect(
      screen.getByText(organizeMsg.willSave("informe-paginas-2.pdf")),
    ).toBeInTheDocument();
  });

  it("con un rango válido extrae esas páginas al pulsar Extraer", async () => {
    const user = userEvent.setup();
    render(<ExtractDialog />);
    await user.click(
      screen.getByRole("radio", { name: organizeMsg.extractRange }),
    );
    await user.type(
      screen.getByRole("textbox", { name: organizeMsg.extractRangeField }),
      "3-4, 1",
    );
    await user.click(screen.getByRole("button", { name: organizeMsg.extract }));
    expect(extractPages).toHaveBeenCalledWith([0, 2, 3]);
  });

  it("un rango no válido deshabilita Extraer y lo explica", async () => {
    const user = userEvent.setup();
    render(<ExtractDialog />);
    await user.click(
      screen.getByRole("radio", { name: organizeMsg.extractRange }),
    );
    await user.type(
      screen.getByRole("textbox", { name: organizeMsg.extractRangeField }),
      "9-99",
    );
    expect(
      screen.getByRole("button", { name: organizeMsg.extract }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("5");
  });

  it("Intro en el campo del rango equivale a pulsar Extraer", async () => {
    const user = userEvent.setup();
    render(<ExtractDialog />);
    await user.click(
      screen.getByRole("radio", { name: organizeMsg.extractRange }),
    );
    await user.type(
      screen.getByRole("textbox", { name: organizeMsg.extractRangeField }),
      "5{Enter}",
    );
    expect(extractPages).toHaveBeenCalledWith([4]);
  });

  it("Escape cierra el diálogo sin extraer", async () => {
    const user = userEvent.setup();
    render(<ExtractDialog />);
    await user.keyboard("{Escape}");
    expect(useExtractDialog.getState().open).toBeNull();
    expect(extractPages).not.toHaveBeenCalled();
  });

  it("avisa de que el PDF nuevo no tendrá contraseña si el original está cifrado", async () => {
    vi.mocked(readCipher).mockResolvedValue("aes-256");
    render(<ExtractDialog />);
    expect(
      await screen.findByText(organizeMsg.newIsUnprotected),
    ).toBeInTheDocument();
  });
});

describe("SplitDialog (PDF-127)", () => {
  it("sin marcadores, «Por marcadores» está deshabilitado y se explica", () => {
    useExtractDialog.setState({ open: "split" });
    render(<SplitDialog />);
    expect(
      screen.getByRole("radio", { name: organizeMsg.byBookmarks }),
    ).toBeDisabled();
    expect(screen.getByText(organizeMsg.noBookmarks)).toBeInTheDocument();
  });

  it("«Cada N páginas» cuenta los archivos y divide con ese N", async () => {
    const user = userEvent.setup();
    useExtractDialog.setState({ open: "split" });
    render(<SplitDialog />);
    const every = screen.getByRole("spinbutton", {
      name: organizeMsg.everyPagesField,
    });
    await user.clear(every);
    await user.type(every, "2");
    expect(screen.getByText(organizeMsg.filesToCreate(3))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: organizeMsg.split }));
    expect(splitDocument).toHaveBeenCalledWith({ mode: "pages", every: 2 });
  });

  it("«Cada» fuera de 1..nº de páginas deshabilita Dividir", async () => {
    const user = userEvent.setup();
    useExtractDialog.setState({ open: "split" });
    render(<SplitDialog />);
    const every = screen.getByRole("spinbutton", {
      name: organizeMsg.everyPagesField,
    });
    await user.clear(every);
    await user.type(every, "9");
    expect(
      screen.getByRole("button", { name: organizeMsg.split }),
    ).toBeDisabled();
  });

  it("por tamaño máximo divide con el tamaño elegido en MB", async () => {
    const user = userEvent.setup();
    useExtractDialog.setState({ open: "split" });
    render(<SplitDialog />);
    await user.click(screen.getByRole("radio", { name: organizeMsg.bySize }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: organizeMsg.sizeField }),
      "25",
    );
    await user.click(screen.getByRole("button", { name: organizeMsg.split }));
    expect(splitDocument).toHaveBeenCalledWith({ mode: "size", mb: 25 });
  });
});

describe("DocOpProgress (PDF-127)", () => {
  it("muestra el progreso con sus valores y Cancelar llama a onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <DocOpProgress
        label={organizeMsg.extractTitle}
        done={2}
        total={5}
        onCancel={onCancel}
      />,
    );
    const bar = screen.getByRole("progressbar", {
      name: organizeMsg.progressLabel,
    });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
    await user.click(screen.getByRole("button", { name: organizeMsg.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape también cancela", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <DocOpProgress
        label={organizeMsg.splitTitle}
        done={0}
        total={0}
        onCancel={onCancel}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: organizeMsg.splitTitle }),
      ).toBeInTheDocument();
    });
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
