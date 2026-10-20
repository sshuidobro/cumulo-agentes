import { useId, useState, type ChangeEvent } from 'react';
import { Dialog } from '../kit/Dialog';
import { securityMsg as msg } from '../messages-security';
import {
  closeProtectDialog,
  protectFormError,
  setProtectForm,
  submitProtectDialog,
  useProtectDialog,
  type ChangesAllowed,
  type ProtectForm,
} from '../../state/protect-actions';
import styles from './ProtectDialog.module.css';

/** Opciones de «Impresión permitida», en el orden del formulario. */
const PRINT_OPTIONS: readonly { readonly value: ProtectForm['print']; readonly label: string }[] = [
  { value: 'none', label: msg.printNone },
  { value: 'low', label: msg.printLow },
  { value: 'high', label: msg.printHigh },
];

/** Opciones de «Cambios permitidos», en el orden del formulario. */
const CHANGES_OPTIONS: readonly { readonly value: ChangesAllowed; readonly label: string }[] = [
  { value: 'none', label: msg.changesNone },
  { value: 'assemble', label: msg.changesAssemble },
  { value: 'forms', label: msg.changesForms },
  { value: 'comments', label: msg.changesComments },
  { value: 'all-but-extract', label: msg.changesAllButExtract },
];

/** Diálogo «Proteger con contraseña» (PDF-132): contraseña para abrir y restricciones de edición e impresión. */
export function ProtectDialog() {
  const open = useProtectDialog((s) => s.open);
  const form = useProtectDialog((s) => s.form);
  const error = protectFormError(form);
  const errorId = useId();
  const openFieldId = useId();
  const openConfirmId = useId();
  const ownerFieldId = useId();
  const ownerConfirmId = useId();
  const printId = useId();
  const changesId = useId();
  const [showOpen, setShowOpen] = useState(false);
  const [showOwner, setShowOwner] = useState(false);

  const checkbox = (event: ChangeEvent<HTMLInputElement>): boolean => event.currentTarget.checked;

  return (
    <Dialog
      open={open}
      title={msg.protectTitle}
      onClose={closeProtectDialog}
      actions={[
        { label: msg.protect, onClick: () => { void submitProtectDialog(); }, disabled: error !== null },
        { label: msg.cancel, onClick: closeProtectDialog },
      ]}
    >
      <fieldset className={styles.group}>
        <legend className={styles.legend}>{msg.openGroup}</legend>
        <label className={styles.option}>
          <input
            type="checkbox"
            data-initial-focus="true"
            checked={form.requireOpen}
            onChange={(event) => { setProtectForm({ requireOpen: checkbox(event) }); }}
          />
          {msg.requireOpen}
        </label>
        {form.requireOpen ? (
          <div className={styles.fields}>
            <label htmlFor={openFieldId}>{msg.openField}</label>
            <input
              id={openFieldId}
              type={showOpen ? 'text' : 'password'}
              autoComplete="new-password"
              className={styles.input}
              value={form.openPassword}
              onChange={(event) => { setProtectForm({ openPassword: event.currentTarget.value }); }}
            />
            <label htmlFor={openConfirmId}>{msg.confirmField}</label>
            <input
              id={openConfirmId}
              type={showOpen ? 'text' : 'password'}
              autoComplete="new-password"
              className={styles.input}
              value={form.openConfirm}
              onChange={(event) => { setProtectForm({ openConfirm: event.currentTarget.value }); }}
            />
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={showOpen}
                onChange={(event) => { setShowOpen(checkbox(event)); }}
              />
              <span>{msg.showPassword}</span>
            </label>
          </div>
        ) : null}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{msg.restrictGroup}</legend>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={form.restrict}
            onChange={(event) => { setProtectForm({ restrict: checkbox(event) }); }}
          />
          {msg.restrict}
        </label>
        {form.restrict ? (
          <div className={styles.fields}>
            <label htmlFor={ownerFieldId}>{msg.ownerField}</label>
            <input
              id={ownerFieldId}
              type={showOwner ? 'text' : 'password'}
              autoComplete="new-password"
              className={styles.input}
              value={form.ownerPassword}
              onChange={(event) => { setProtectForm({ ownerPassword: event.currentTarget.value }); }}
            />
            <label htmlFor={ownerConfirmId}>{msg.confirmField}</label>
            <input
              id={ownerConfirmId}
              type={showOwner ? 'text' : 'password'}
              autoComplete="new-password"
              className={styles.input}
              value={form.ownerConfirm}
              onChange={(event) => { setProtectForm({ ownerConfirm: event.currentTarget.value }); }}
            />
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={showOwner}
                onChange={(event) => { setShowOwner(checkbox(event)); }}
              />
              <span>{msg.showPassword}</span>
            </label>
            <label htmlFor={printId}>{msg.printLabel}</label>
            <select
              id={printId}
              className={styles.input}
              value={form.print}
              onChange={(event) => { setProtectForm({ print: event.currentTarget.value as ProtectForm['print'] }); }}
            >
              {PRINT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <label htmlFor={changesId}>{msg.changesLabel}</label>
            <select
              id={changesId}
              className={styles.input}
              value={form.changes}
              onChange={(event) => { setProtectForm({ changes: event.currentTarget.value as ChangesAllowed }); }}
            >
              {CHANGES_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <label className={styles.option}>
              <input
                type="checkbox"
                checked={form.copy}
                onChange={(event) => { setProtectForm({ copy: checkbox(event) }); }}
              />
              {msg.allowCopy}
            </label>
          </div>
        ) : null}
      </fieldset>

      <p className={styles.warning}>{msg.forgetWarning}</p>
      {error !== null ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
