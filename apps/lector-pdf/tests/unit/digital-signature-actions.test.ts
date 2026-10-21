import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, platformError, type OpenedFile } from '@suite/platform';
import { err, ok } from '@suite/shared';
import { pdfError } from '../../src/core/errors';
import { inProcessDocOps, setDocOpsRunner } from '../../src/state/doc-ops';
import {
  cancelPlacing,
  chooseCertificate,
  closeSignDialog,
  openSignDialog,
  refreshSignatures,
  registerSignatureParticipant,
  signAtCurrentPageCenter,
  signDocument,
  signInvisible,
  startPlacing,
  unlockCertificate,
  useSignatures,
  useSignDialog,
} from '../../src/state/digital-signature-actions';
import { useViewer } from '../../src/state/viewer-store';
import { digitalSignMsg } from '../../src/ui/messages-digital-signature';
import { certFixtures, TEST_P12_PASSWORD } from '../support/certs';
import { openedFile } from '../helpers/fake-platform';
import { fixtureBytes, openFixture, setupSaveHarness, concat } from '../helpers/save-harness';

const h = setupSaveHarness();

// Lo mismo que hace main.tsx al arrancar: vigila el visor para validar las firmas al abrir un documento.
registerSignatureParticipant();

/** Texto de la última notificación visible. */
function notice(): string | undefined {
  return useViewer.getState().notice?.text;
}

const SIGNED_AT = '2026-10-20T10:00:00.000Z';

/** Un PDF firmado de verdad: la firma la produce la operación `sign` del núcleo. */
async function signedBytes(): Promise<Uint8Array> {
  const original = fixtureBytes('basic-5.pdf');
  const result = await inProcessDocOps().run<{ readonly delta: Uint8Array }>(
    'sign',
    {
      password: null,
      p12: certFixtures().rsaAes,
      p12Password: TEST_P12_PASSWORD,
      pageIndex: 0,
      rect: null,
      reason: 'Revisado',
      location: 'Madrid',
      now: SIGNED_AT,
    },
    [memorySource(original)],
  );
  if (!result.ok) throw new Error(result.error.message);
  return concat(original, result.value.delta);
}

/** Pone un certificado de prueba en el formulario, como lo deja «Elegir certificado…». */
function pickTestCertificate(): void {
  h.platform.importFile = vi.fn(async () => ok({ name: 'prueba.p12', bytes: certFixtures().rsaAes }));
}

describe('firma digital: estado del diálogo y del certificado', () => {
  beforeEach(() => {
    setDocOpsRunner(inProcessDocOps());
  });

  afterEach(() => {
    setDocOpsRunner(null);
    closeSignDialog();
    cancelPlacing();
    useSignatures.setState({ status: 'idle', list: [] });
  });

  it('elegir un certificado guarda sus bytes y su nombre, sin contraseña ni datos del anterior', async () => {
    pickTestCertificate();
    await chooseCertificate();
    const { form } = useSignDialog.getState();
    expect(form.p12?.name).toBe('prueba.p12');
    expect(form.p12?.bytes.length).toBeGreaterThan(0);
    expect(form.password).toBe('');
    expect(form.info).toBeNull();
  });

  it('cancelar el selector no cambia el formulario', async () => {
    h.platform.importFile = vi.fn(async () => ok(null));
    await chooseCertificate();
    expect(useSignDialog.getState().form.p12).toBeNull();
  });

  it('un certificado demasiado grande se rechaza con un mensaje', async () => {
    h.platform.importFile = vi.fn(async () => err(platformError('out-of-range')));
    await chooseCertificate();
    expect(useSignDialog.getState().error).toBe(digitalSignMsg.certificateTooLarge);
  });

  it('desbloquear con la contraseña buena guarda los datos del titular; con la mala deja un mensaje', async () => {
    pickTestCertificate();
    await chooseCertificate();

    expect(await unlockCertificate('mala')).toBe(false);
    expect(useSignDialog.getState().error).toBe(digitalSignMsg.unlockFailed);
    expect(useSignDialog.getState().form.info).toBeNull();

    expect(await unlockCertificate(TEST_P12_PASSWORD)).toBe(true);
    const { form, error } = useSignDialog.getState();
    expect(error).toBeNull();
    expect(form.info?.subject).toBe('Prueba Cúmulo');
    expect(form.password).toBe(TEST_P12_PASSWORD);
  });

  it('sin certificado no se puede desbloquear ni colocar la firma', async () => {
    expect(await unlockCertificate('x')).toBe(false);
    startPlacing();
    expect(useSignDialog.getState().placing).toBe(false);
  });

  it('cancelar la colocación borra el certificado y su contraseña de la memoria', async () => {
    pickTestCertificate();
    await chooseCertificate();
    await unlockCertificate(TEST_P12_PASSWORD);
    startPlacing();
    expect(useSignDialog.getState()).toMatchObject({ open: false, placing: true });
    cancelPlacing();
    const { form, placing } = useSignDialog.getState();
    expect(placing).toBe(false);
    expect(form.p12).toBeNull();
    expect(form.password).toBe('');
    expect(form.info).toBeNull();
  });

  it('el motivo y el lugar se conservan entre aperturas del diálogo, el certificado no', async () => {
    await openFixture();
    openSignDialog();
    useSignDialog.setState((s) => ({ form: { ...s.form, reason: 'Revisión', location: 'Sevilla', visible: true } }));
    closeSignDialog();
    openSignDialog();
    const { form } = useSignDialog.getState();
    expect(form).toMatchObject({ reason: 'Revisión', location: 'Sevilla', visible: true, p12: null, info: null });
  });

  it('un documento cifrado avisa antes de pedir nada y no abre el diálogo', () => {
    useViewer.setState({ encrypted: true, status: 'ready', file: openedFile('x.pdf', memorySource(new Uint8Array(0))) });
    openSignDialog();
    expect(useSignDialog.getState().open).toBe(false);
    expect(notice()).toBe(pdfError('sign-encrypted').message);
    useViewer.setState({ encrypted: false });
  });

  it('firmar sin certificado desbloqueado no escribe nada', async () => {
    await openFixture();
    const result = await signDocument(0, null);
    expect(result).toBe('failed');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('la contraseña y los bytes del certificado nunca se escriben en las preferencias', async () => {
    const set = vi.spyOn(h.platform.prefs, 'set');
    await openFixture();
    pickTestCertificate();
    await chooseCertificate();
    await unlockCertificate(TEST_P12_PASSWORD);
    expect(await signInvisible()).toBe('saved');
    expect(h.save).toHaveBeenCalledTimes(1);
    const written = JSON.stringify(set.mock.calls);
    expect(written).not.toContain(TEST_P12_PASSWORD);
    expect(written).not.toContain('prueba.p12');
    set.mockRestore();
  });
});

describe('firma digital: firmar y validar', () => {
  beforeEach(() => {
    setDocOpsRunner(inProcessDocOps());
  });

  afterEach(() => {
    setDocOpsRunner(null);
    closeSignDialog();
    cancelPlacing();
  });

  it('firma invisible: escribe un incremento y el documento reabierto queda con una firma válida', async () => {
    await openFixture();
    pickTestCertificate();
    await chooseCertificate();
    await unlockCertificate(TEST_P12_PASSWORD);

    expect(await signInvisible()).toBe('saved');
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0]?.[1]).toMatchObject({ kind: 'append' });

    await vi.waitFor(() => {
      expect(useSignatures.getState().status).toBe('ready');
    });
    const [signature] = useSignatures.getState().list;
    expect(useSignatures.getState().list).toHaveLength(1);
    expect(signature?.verdict).toBe('valid');
    expect(signature?.signer?.subject).toBe('Prueba Cúmulo');
    expect(signature?.problem).toBeNull();
    expect(signature?.changedAfter).toBe(false);
    expect(useSignDialog.getState().form.p12).toBeNull();
  });

  it('firma en el centro de la página actual con el recuadro de teclado', async () => {
    await openFixture();
    pickTestCertificate();
    await chooseCertificate();
    await unlockCertificate(TEST_P12_PASSWORD);
    const pending = signAtCurrentPageCenter();
    expect(pending).not.toBeNull();
    expect(await pending).toBe('saved');
    await vi.waitFor(() => {
      expect(useSignatures.getState().list).toHaveLength(1);
    });
  });

  it('refrescar un documento sin firmas deja la lista vacía', async () => {
    await openFixture();
    await refreshSignatures();
    expect(useSignatures.getState().list).toEqual([]);
    expect(useSignatures.getState().status).toBe('ready');
  });

  it('validar un PDF firmado lo marca como válido sin pasar por la interfaz', async () => {
    const file: OpenedFile = { ...openedFile('firmado.pdf', memorySource(await signedBytes())), canSaveInPlace: true };
    const { openDocument } = await import('../../src/state/document-actions');
    await openDocument(file);
    await vi.waitFor(() => {
      expect(useSignatures.getState().status).toBe('ready');
      expect(useSignatures.getState().list).toHaveLength(1);
    });
    expect(useSignatures.getState().list[0]?.verdict).toBe('valid');
    expect(useSignatures.getState().list[0]?.reason).toBe('Revisado');
    expect(useSignatures.getState().list[0]?.location).toBe('Madrid');
    expect(useSignatures.getState().list[0]?.signedAt).toBe(SIGNED_AT);
  });
});
