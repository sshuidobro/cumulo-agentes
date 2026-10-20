import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { err, ok } from '@suite/shared';
import { createFakePlatform, openedFile } from '../../helpers/fake-platform';
import { PAGE_IMAGE_WIDTH_PT } from '../../../src/core/signature/signature';
import type { SignatureArt } from '../../../src/core/annotations/model';
import { ALL_PERMISSIONS } from '../../../src/core/permissions';
import { pdfError } from '../../../src/core/errors';
import type { LoadedPdf } from '../../../src/engine';
import {
  beginFreeText,
  choosePageImage,
  commitFreeText,
  endAnnotationSession,
  getEffective,
  placeSignature,
  setCommentBarOpen,
  setEditBarOpen,
  setTool,
  setToolColor,
} from '../../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../../src/state/annotation-store';
import { initServices } from '../../../src/state/services';
import { initialViewerState, useViewer } from '../../../src/state/viewer-store';
import { signatureFromImageFile } from '../../../src/ui/signature/image-art';
import { editMsg } from '../../../src/ui/messages-edit';

// La decodificación de imágenes necesita el navegador: aquí se simula el resultado.
vi.mock('../../../src/ui/signature/image-art', () => ({ signatureFromImageFile: vi.fn() }));

const PNG_ART: SignatureArt = { kind: 'image', format: 'jpeg', data: 'AAAA', pixelWidth: 400, pixelHeight: 100 };
const PAGE_BOX = [0, 0, 612, 792] as const;
const FLOOR = 0;

let platform: Platform;

function setUpDocument(permissions = ALL_PERMISSIONS): void {
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    pdf: {} as unknown as LoadedPdf,
    file: openedFile('doc.pdf', memorySource(new Uint8Array([0x25]))),
    permissions,
  });
}

beforeEach(() => {
  platform = createFakePlatform({ prefs: createStorageStore(null, 'test.') });
  initServices({ platform, assetBaseUrl: '' });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  setUpDocument();
  vi.mocked(signatureFromImageFile).mockReset();
});

afterEach(() => {
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState(initialViewerState);
});

/** Texto añadido con «Añadir texto» (`page-text`): clic, texto y confirmación. Devuelve su id. */
function addPageText(text: string): string {
  setTool('page-text');
  beginFreeText(0, [72, 600, 272, 620], FLOOR);
  commitFreeText(text);
  const created = [...getEffective().values()].find((a) => a.type === 'freetext' && a.contents === text);
  if (created === undefined) throw new Error('no se creó el texto');
  return created.id;
}

describe('«Añadir texto» (page-text, PDF-130)', () => {
  it('la anotación creada lleva flatten y borderless, y el texto negro por defecto', () => {
    const id = addPageText('Añadido por mí');
    const a = getEffective().get(id);
    expect(a?.type).toBe('freetext');
    if (a?.type !== 'freetext') return;
    expect(a.flatten).toBe(true);
    expect(a.borderless).toBe(true);
    expect(a.textColor).toEqual([0, 0, 0]);
    expect(useAnnotations.getState().colors['page-text']).toEqual([0, 0, 0]);
  });

  it('el texto libre normal no lleva flatten ni borderless', () => {
    setTool('freetext');
    beginFreeText(0, [72, 600, 272, 620], FLOOR);
    commitFreeText('Comentario');
    const a = [...getEffective().values()].find((x) => x.type === 'freetext');
    expect(a?.type).toBe('freetext');
    if (a?.type !== 'freetext') return;
    expect(a).not.toHaveProperty('flatten');
    expect(a).not.toHaveProperty('borderless');
  });

  it('el color de «Añadir texto» se guarda aparte del de texto libre', () => {
    const freetextBefore = useAnnotations.getState().colors.freetext;
    setToolColor('page-text', [0.9, 0.22, 0.21]);
    expect(useAnnotations.getState().colors['page-text']).toEqual([0.9, 0.22, 0.21]);
    expect(useAnnotations.getState().colors.freetext).toEqual(freetextBefore);
  });

  it('sin texto no crea nada', () => {
    setTool('page-text');
    beginFreeText(0, [72, 600, 272, 620], FLOOR);
    commitFreeText('   ');
    expect([...getEffective().values()]).toHaveLength(0);
  });
});

describe('«Añadir imagen» (page-image, PDF-130)', () => {
  it('elegir una imagen la deja pendiente con la herramienta page-image', async () => {
    const importFile = vi.fn(async () => ok({ name: 'logo.png', bytes: new Uint8Array([1, 2, 3]) }));
    platform = createFakePlatform({ importFile, prefs: createStorageStore(null, 'test.') });
    initServices({ platform, assetBaseUrl: '' });
    vi.mocked(signatureFromImageFile).mockResolvedValue(ok(PNG_ART));

    await choosePageImage();

    expect(importFile).toHaveBeenCalledWith(
      [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg'] }],
      20 * 1024 * 1024,
    );
    expect(useAnnotations.getState().tool).toBe('page-image');
    expect(useAnnotations.getState().pendingSignature).toEqual(PNG_ART);
  });

  it('un fichero que no se puede decodificar no cambia la herramienta', async () => {
    const importFile = vi.fn(async () => ok({ name: 'x.png', bytes: new Uint8Array([0]) }));
    platform = createFakePlatform({ importFile, prefs: createStorageStore(null, 'test.') });
    initServices({ platform, assetBaseUrl: '' });
    vi.mocked(signatureFromImageFile).mockResolvedValue(err(pdfError('invalid-image')));

    await choosePageImage();

    expect(useAnnotations.getState().tool).toBe('none');
    expect(useAnnotations.getState().pendingSignature).toBeNull();
  });

  it('sin documento abierto no abre el selector', async () => {
    const importFile = vi.fn(async () => ok(null));
    platform = createFakePlatform({ importFile, prefs: createStorageStore(null, 'test.') });
    initServices({ platform, assetBaseUrl: '' });
    useViewer.setState({ pdf: null });

    await choosePageImage();

    expect(importFile).not.toHaveBeenCalled();
  });

  it('colocarla crea una firma aplanada de 200 pt de ancho, con la proporción de la imagen, y vuelve a ninguna', async () => {
    vi.mocked(signatureFromImageFile).mockResolvedValue(ok(PNG_ART));
    platform = createFakePlatform({
      importFile: vi.fn(async () => ok({ name: 'logo.png', bytes: new Uint8Array([1]) })),
      prefs: createStorageStore(null, 'test.'),
    });
    initServices({ platform, assetBaseUrl: '' });
    await choosePageImage();

    const id = placeSignature(0, [300, 400], [...PAGE_BOX]);

    expect(id).not.toBeNull();
    const a = getEffective().get(id ?? '');
    expect(a?.type).toBe('signature');
    if (a?.type !== 'signature') return;
    expect(a.flatten).toBe(true);
    const [x1, y1, x2, y2] = a.rect;
    expect(x2 - x1).toBeCloseTo(PAGE_IMAGE_WIDTH_PT);
    expect((x2 - x1) / (y2 - y1)).toBeCloseTo(4);
    expect(useAnnotations.getState().tool).toBe('none');
  });

  it('una firma colocada con la herramienta signature no se aplana', () => {
    useAnnotations.setState({ pendingSignature: PNG_ART, tool: 'signature' });
    const id = placeSignature(0, [300, 400], [...PAGE_BOX]);
    const a = getEffective().get(id ?? '');
    expect(a?.type).toBe('signature');
    expect(a).not.toHaveProperty('flatten');
  });
});

describe('permisos del PDF (PDF-130)', () => {
  it('sin permiso de modificar, añadir texto avisa una vez y lo permite', () => {
    setUpDocument({ ...ALL_PERMISSIONS, modify: false });
    addPageText('primero');
    expect(useViewer.getState().notice?.text).toBe(editMsg.modifyAnyway);
    useViewer.setState({ notice: null });
    addPageText('segundo');
    expect(useViewer.getState().notice).toBeNull();
    expect([...getEffective().values()]).toHaveLength(2);
  });

  it('con permiso de modificar no avisa', () => {
    addPageText('texto');
    expect(useViewer.getState().notice).toBeNull();
  });
});

describe('barras «Comentar» y «Editar» (PDF-130)', () => {
  it('abrir «Editar» cierra «Comentar» y al revés', () => {
    setCommentBarOpen(true);
    setEditBarOpen(true);
    expect(useAnnotations.getState().editBarOpen).toBe(true);
    expect(useAnnotations.getState().commentBarOpen).toBe(false);

    setCommentBarOpen(true);
    expect(useAnnotations.getState().commentBarOpen).toBe(true);
    expect(useAnnotations.getState().editBarOpen).toBe(false);
  });

  it('cerrar «Editar» devuelve la herramienta a ninguna', () => {
    setEditBarOpen(true);
    setTool('page-text');
    setEditBarOpen(false);
    expect(useAnnotations.getState().editBarOpen).toBe(false);
    expect(useAnnotations.getState().tool).toBe('none');
  });
});
