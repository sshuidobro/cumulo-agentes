// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useProtectDialog, type ProtectForm } from '../../src/state/protect-actions';
import { ProtectDialog } from '../../src/ui/security/ProtectDialog';
import { securityMsg } from '../../src/ui/messages-security';

const NONE: ProtectForm = {
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

function openWith(form: ProtectForm): void {
  useProtectDialog.setState({ open: true, form });
}

function dialog() {
  return screen.getByRole('dialog', { name: securityMsg.protectTitle });
}

/** El botón «Proteger» del pie (el de la barra de acciones del diálogo, no el título). */
function protectButton() {
  return within(dialog()).getByRole('button', { name: securityMsg.protect });
}

beforeEach(() => {
  useProtectDialog.setState({ open: false, form: NONE });
});

afterEach(() => {
  useProtectDialog.setState({ open: false, form: NONE });
});

describe('ProtectDialog (PDF-132)', () => {
  it('sin ninguna protección: aviso en role=alert y «Proteger» deshabilitado', () => {
    openWith(NONE);
    render(<ProtectDialog />);

    expect(within(dialog()).getByRole('alert')).toHaveTextContent(securityMsg.chooseOne);
    expect(protectButton()).toBeDisabled();
  });

  it('el aviso de olvidar la contraseña de apertura siempre está visible', () => {
    openWith(NONE);
    render(<ProtectDialog />);

    expect(dialog()).toHaveTextContent(securityMsg.forgetWarning);
  });

  it('marcar «Pedir contraseña» muestra los campos y pide escribirla', async () => {
    const user = userEvent.setup();
    openWith(NONE);
    render(<ProtectDialog />);

    await user.click(screen.getByRole('checkbox', { name: securityMsg.requireOpen }));

    expect(screen.getAllByLabelText(securityMsg.confirmField)).toHaveLength(1);
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(securityMsg.passwordRequired);
    expect(protectButton()).toBeDisabled();
  });

  it('confirmación distinta: «Las contraseñas no coinciden.»; igual: el botón se habilita', async () => {
    const user = userEvent.setup();
    openWith(NONE);
    render(<ProtectDialog />);
    await user.click(screen.getByRole('checkbox', { name: securityMsg.requireOpen }));

    await user.type(screen.getByLabelText(securityMsg.openField), 'abc');
    await user.type(screen.getByLabelText(securityMsg.confirmField), 'abd');
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(securityMsg.passwordMismatch);
    expect(protectButton()).toBeDisabled();

    await user.clear(screen.getByLabelText(securityMsg.confirmField));
    await user.type(screen.getByLabelText(securityMsg.confirmField), 'abc');
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    expect(protectButton()).toBeEnabled();
  });

  it('«Mostrar contraseña» cambia el campo de contraseña a texto visible', async () => {
    const user = userEvent.setup();
    openWith({ ...NONE, requireOpen: true });
    render(<ProtectDialog />);
    const field = screen.getByLabelText(securityMsg.openField);
    expect(field).toHaveAttribute('type', 'password');

    await user.click(within(dialog()).getByRole('checkbox', { name: securityMsg.showPassword }));

    expect(field).toHaveAttribute('type', 'text');
  });

  it('restricciones: los selectores reflejan y cambian el formulario', async () => {
    const user = userEvent.setup();
    openWith({ ...NONE, restrict: true, ownerPassword: 'p', ownerConfirm: 'p' });
    render(<ProtectDialog />);

    await user.selectOptions(screen.getByRole('combobox', { name: securityMsg.printLabel }), 'none');
    await user.selectOptions(screen.getByRole('combobox', { name: securityMsg.changesLabel }), 'forms');
    await user.click(screen.getByRole('checkbox', { name: securityMsg.allowCopy }));

    expect(useProtectDialog.getState().form).toMatchObject({ print: 'none', changes: 'forms', copy: false });
    expect(protectButton()).toBeEnabled();
  });

  it('«Cancelar» cierra el diálogo sin cambiar el formulario', async () => {
    const user = userEvent.setup();
    openWith({ ...NONE, requireOpen: true, openPassword: 'abc', openConfirm: 'abc' });
    render(<ProtectDialog />);

    await user.click(within(dialog()).getByRole('button', { name: securityMsg.cancel }));

    expect(useProtectDialog.getState().open).toBe(false);
    expect(useProtectDialog.getState().form.openPassword).toBe('abc');
  });

  it('Esc cierra el diálogo', async () => {
    const user = userEvent.setup();
    openWith(NONE);
    render(<ProtectDialog />);

    await user.keyboard('{Escape}');

    expect(useProtectDialog.getState().open).toBe(false);
  });

  it('el foco inicial está en la primera casilla, operable con teclado', async () => {
    const user = userEvent.setup();
    openWith(NONE);
    render(<ProtectDialog />);

    expect(screen.getByRole('checkbox', { name: securityMsg.requireOpen })).toHaveFocus();
    await user.keyboard(' ');
    expect(useProtectDialog.getState().form.requireOpen).toBe(true);
  });

  it('cada campo de contraseña tiene etiqueta accesible', () => {
    openWith({ ...NONE, requireOpen: true, restrict: true });
    render(<ProtectDialog />);

    expect(screen.getByLabelText(securityMsg.openField)).toBeInTheDocument();
    expect(screen.getByLabelText(securityMsg.ownerField)).toBeInTheDocument();
    expect(screen.getAllByLabelText(securityMsg.confirmField)).toHaveLength(2);
  });
});
