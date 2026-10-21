// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@suite/shared';
import type { LoadedPdf, PDFDocumentProxy } from '../../src/engine';
import { pdfError } from '../../src/core/errors';
import type * as DocOps from '../../src/state/doc-ops';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { useSignDialog, type SignForm } from '../../src/state/digital-signature-actions';
import { DigitalSignDialog } from '../../src/ui/signature/DigitalSignDialog';
import { digitalSignMsg } from '../../src/ui/messages-digital-signature';
import { certFixtures, TEST_P12_PASSWORD } from '../support/certs';
import { createFakePlatform } from '../helpers/fake-platform';

// jsdom no conserva el realm de Uint8Array a través del MessageChannel del Worker: la operación `p12-info` se
// simula aquí. Su lógica real se prueba en tests/unit/digital-signature-actions.test.ts y doc-ops/signature-ops.
vi.mock('../../src/state/doc-ops', async (importOriginal) => ({
  ...(await importOriginal<typeof DocOps>()),
  runDocOp: vi.fn(async (op: string, args: { readonly password: string }) => {
    if (op !== 'p12-info') throw new Error(`operación inesperada: ${op}`);
    return args.password === TEST_P12_PASSWORD
      ? ok({ subject: 'Prueba Cúmulo', issuer: 'Autoridad de prueba', serial: '01', validFrom: '2000-01-01T00:00:00.000Z', validTo: '2100-01-01T00:00:00.000Z' })
      : err(pdfError('save-wrong-password'));
  }),
}));

/** Certificado vigente de forma permanente: el test no depende de la hora. */
const VALID_INFO = {
  subject: 'Prueba Cúmulo',
  issuer: 'Prueba Cúmulo',
  serial: '01',
  validFrom: '2000-01-01T00:00:00.000Z',
  validTo: '2100-01-01T00:00:00.000Z',
};

const EMPTY: SignForm = { p12: null, password: '', info: null, visible: false, reason: '', location: '' };

function setForm(form: Partial<SignForm>): void {
  useSignDialog.setState({ open: true, form: { ...EMPTY, ...form }, placing: false, error: null });
}

beforeEach(() => {
  const pdf = { doc: {} as PDFDocumentProxy, numPages: 3, fingerprint: 'fake' } as unknown as LoadedPdf;
  useViewer.setState({ ...initialViewerState, status: 'ready', pdf, currentPage: 0 });
  setForm({});
});

afterEach(() => {
  vi.clearAllMocks();
  useSignDialog.setState({ open: false, form: EMPTY, placing: false, error: null });
  useViewer.setState(initialViewerState);
});

describe('DigitalSignDialog', () => {
  it('sin certificado pide elegirlo y no deja firmar', () => {
    render(<DigitalSignDialog />);
    expect(screen.getByRole('dialog', { name: digitalSignMsg.dialogTitle })).toBeInTheDocument();
    expect(screen.getByText(digitalSignMsg.noCertificate)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: digitalSignMsg.chooseCertificate })).toBeEnabled();
    expect(screen.getByRole('button', { name: digitalSignMsg.sign })).toBeDisabled();
    expect(screen.getByText(digitalSignMsg.localNote)).toBeInTheDocument();
  });

  it('elegir un certificado muestra su nombre y el campo de contraseña', async () => {
    initServices({
      platform: createFakePlatform({ importFile: vi.fn(async () => ok({ name: 'mi-firma.p12', bytes: certFixtures().rsaAes })) }),
      assetBaseUrl: '',
    });
    const user = userEvent.setup();
    render(<DigitalSignDialog />);
    await user.click(screen.getByRole('button', { name: digitalSignMsg.chooseCertificate }));
    expect(await screen.findByText('mi-firma.p12')).toBeInTheDocument();
    expect(screen.getByLabelText(digitalSignMsg.passwordLabel)).toHaveValue('');
  });

  it('una contraseña errónea muestra el mensaje y Firmar sigue deshabilitado', async () => {
    setForm({ p12: { name: 'mi-firma.p12', bytes: certFixtures().rsaAes } });
    const user = userEvent.setup();
    render(<DigitalSignDialog />);
    await user.type(screen.getByLabelText(digitalSignMsg.passwordLabel), 'mala');
    await user.click(screen.getByRole('button', { name: digitalSignMsg.unlock }));
    expect(await screen.findByRole('alert')).toHaveTextContent(digitalSignMsg.unlockFailed);
    expect(screen.getByRole('button', { name: digitalSignMsg.sign })).toBeDisabled();
  });

  it('Intro en la contraseña desbloquea; con la buena, Firmar se habilita y la contraseña se borra del campo', async () => {
    setForm({ p12: { name: 'mi-firma.p12', bytes: certFixtures().rsaAes } });
    const user = userEvent.setup();
    render(<DigitalSignDialog />);
    const password = screen.getByLabelText(digitalSignMsg.passwordLabel);
    await user.type(password, `${TEST_P12_PASSWORD}{Enter}`);
    expect(await screen.findByText(digitalSignMsg.unlocked)).toBeInTheDocument();
    expect(password).toHaveValue('');
    expect(screen.getByText('Prueba Cúmulo', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('Autoridad de prueba', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: digitalSignMsg.sign })).toBeEnabled();
    expect(useSignDialog.getState().form.password).toBe(TEST_P12_PASSWORD);
  });

  it('cancelar y reabrir el diálogo deja la contraseña escrita fuera: el campo vuelve vacío', async () => {
    setForm({ p12: { name: 'mi-firma.p12', bytes: certFixtures().rsaAes } });
    const user = userEvent.setup();
    render(<DigitalSignDialog />);
    await user.type(screen.getByLabelText(digitalSignMsg.passwordLabel), 'escrita-sin-enviar');
    await user.click(screen.getByRole('button', { name: digitalSignMsg.cancel }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      setForm({ p12: { name: 'mi-firma.p12', bytes: certFixtures().rsaAes } });
    });
    expect(screen.getByLabelText(digitalSignMsg.passwordLabel)).toHaveValue('');
  });

  it('elegir otro certificado con el diálogo abierto borra la contraseña escrita para el anterior', async () => {
    setForm({ p12: { name: 'mi-firma.p12', bytes: certFixtures().rsaAes } });
    const user = userEvent.setup();
    render(<DigitalSignDialog />);
    await user.type(screen.getByLabelText(digitalSignMsg.passwordLabel), 'contra-del-primero');
    act(() => {
      const form = useSignDialog.getState().form;
      useSignDialog.setState({ form: { ...form, p12: { name: 'otro.p12', bytes: certFixtures().rsaAes } } });
    });
    expect(screen.getByText('otro.p12')).toBeInTheDocument();
    expect(screen.getByLabelText(digitalSignMsg.passwordLabel)).toHaveValue('');
  });

  it('un certificado caducado avisa y no se puede firmar con él', () => {
    setForm({
      p12: { name: 'vieja.p12', bytes: certFixtures().rsaAes },
      info: { ...VALID_INFO, validFrom: '2000-01-01T00:00:00.000Z', validTo: '2001-01-01T00:00:00.000Z' },
    });
    render(<DigitalSignDialog />);
    expect(screen.getByRole('alert')).toHaveTextContent(digitalSignMsg.certExpired);
    expect(screen.getByRole('button', { name: digitalSignMsg.sign })).toBeDisabled();
  });

  it('con firma visible, el botón pasa a «Colocar y firmar» y activa la colocación', async () => {
    setForm({ p12: { name: 'mi-firma.p12', bytes: certFixtures().rsaAes }, info: VALID_INFO, visible: true });
    const user = userEvent.setup();
    render(<DigitalSignDialog />);
    expect(screen.getByRole('radio', { name: digitalSignMsg.visibleOption })).toBeChecked();
    await user.click(screen.getByRole('button', { name: digitalSignMsg.placeAndSign }));
    expect(useSignDialog.getState()).toMatchObject({ open: false, placing: true });
    expect(useSignDialog.getState().form.p12).not.toBeNull();
  });

  it('con firma invisible, Firmar cierra el diálogo y lanza la firma', async () => {
    setForm({ p12: { name: 'mi-firma.p12', bytes: certFixtures().rsaAes }, info: VALID_INFO, visible: false });
    const user = userEvent.setup();
    render(<DigitalSignDialog />);
    await user.click(screen.getByRole('radio', { name: digitalSignMsg.invisibleOption }));
    await user.click(screen.getByRole('button', { name: digitalSignMsg.sign }));
    expect(useSignDialog.getState().open).toBe(false);
  });

  it('motivo y lugar se guardan en el formulario (sin tocar el certificado)', async () => {
    setForm({});
    const user = userEvent.setup();
    render(<DigitalSignDialog />);
    await user.type(screen.getByLabelText(digitalSignMsg.reasonLabel), 'Revisado');
    await user.type(screen.getByLabelText(digitalSignMsg.locationLabel), 'Madrid');
    expect(useSignDialog.getState().form).toMatchObject({ reason: 'Revisado', location: 'Madrid', p12: null });
  });
});
