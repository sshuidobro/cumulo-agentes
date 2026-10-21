// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignatureStatus } from '../../src/core/signature/digital';
import { useSignatures } from '../../src/state/digital-signature-actions';
import { goToPage } from '../../src/state/navigation';
import { SignaturesPanel } from '../../src/ui/sidebar/SignaturesPanel';
import { digitalSignMsg } from '../../src/ui/messages-digital-signature';

vi.mock('../../src/state/navigation', () => ({ goToPage: vi.fn() }));

const BASE: SignatureStatus = {
  fieldName: 'Firma 1',
  pageIndex: 1,
  signer: { subject: 'Prueba Cúmulo', issuer: 'Prueba Cúmulo', serial: '01', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2036-01-01T00:00:00.000Z' },
  signedAt: '2026-10-20T10:00:00.000Z',
  reason: 'Revisado',
  location: 'Madrid',
  subFilter: 'ETSI.CAdES.detached',
  verdict: 'valid',
  problem: null,
  changedAfter: false,
};

beforeEach(() => {
  useSignatures.setState({ status: 'ready', list: [BASE] });
});

afterEach(() => {
  vi.clearAllMocks();
  useSignatures.setState({ status: 'idle', list: [] });
});

describe('pestaña Firmas', () => {
  it('una firma válida muestra titular, estado sin verificar la identidad, motivo y lugar', () => {
    render(<SignaturesPanel />);
    expect(screen.getByText('Prueba Cúmulo', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(digitalSignMsg.validSignature)).toBeInTheDocument();
    expect(screen.getByText('Revisado')).toBeInTheDocument();
    expect(screen.getByText('Madrid')).toBeInTheDocument();
  });

  it('una firma inválida muestra su motivo, y los cambios posteriores se avisan', () => {
    useSignatures.setState({
      status: 'ready',
      list: [
        { ...BASE, fieldName: 'Firma 2', verdict: 'invalid', problem: digitalSignMsg.statusInvalid },
        { ...BASE, fieldName: 'Firma 3', changedAfter: true },
      ],
    });
    render(<SignaturesPanel />);
    expect(screen.getByText(digitalSignMsg.statusInvalid)).toBeInTheDocument();
    expect(screen.getByText(`${digitalSignMsg.validSignature} ${digitalSignMsg.changedAfter}`)).toBeInTheDocument();
  });

  it('clic en una firma va a la página donde está su recuadro', async () => {
    const user = userEvent.setup();
    render(<SignaturesPanel />);
    const goTo = screen.getByRole('button', { name: /Prueba Cúmulo/ });
    expect(goTo).toHaveAttribute('title', digitalSignMsg.goToPage(2));
    await user.click(goTo);
    expect(goToPage).toHaveBeenCalledWith(1);
  });

  it('una firma sin página no es un botón', () => {
    useSignatures.setState({ status: 'ready', list: [{ ...BASE, pageIndex: null }] });
    render(<SignaturesPanel />);
    expect(screen.queryByRole('button', { name: /Prueba Cúmulo/ })).toBeNull();
    expect(screen.getByText('Prueba Cúmulo', { selector: 'span' })).toBeInTheDocument();
  });

  it('mientras se comprueba, o si falla, lo dice', () => {
    useSignatures.setState({ status: 'checking', list: [] });
    const { unmount } = render(<SignaturesPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(digitalSignMsg.checking);
    unmount();
    useSignatures.setState({ status: 'error', list: [] });
    render(<SignaturesPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(digitalSignMsg.checkFailed);
  });

  it('sin firmas lo indica', () => {
    useSignatures.setState({ status: 'ready', list: [] });
    render(<SignaturesPanel />);
    expect(screen.getByText(digitalSignMsg.noSignatures)).toBeInTheDocument();
  });
});
