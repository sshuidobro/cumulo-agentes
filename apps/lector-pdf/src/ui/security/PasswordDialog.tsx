import { useId, useState, type KeyboardEvent } from 'react';
import { cancelPassword, submitPassword, usePasswordPrompt } from '../../state/password-prompt';
import { Dialog } from '../kit/Dialog';
import { securityMsg as msg } from '../messages-security';
import styles from './PasswordDialog.module.css';

/** Pinta el diálogo «Contraseña necesaria» cuando hay una petición (`askPassword`). Sin petición no muestra nada. */
export function PasswordDialog() {
  const request = usePasswordPrompt((s) => s.request);
  if (request === null) return null;
  // Con `key` cada intento empieza con el campo vacío y el foco en él.
  return <PasswordPrompt key={request.id} name={request.name} incorrect={request.incorrect} text={request.text} />;
}

function PasswordPrompt({
  name,
  incorrect,
  text,
}: {
  readonly name: string;
  readonly incorrect: boolean;
  readonly text: string | null;
}) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const fieldId = useId();

  const submit = (): void => {
    if (value !== '') submitPassword(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Dialog
      open
      title={msg.title}
      onClose={cancelPassword}
      actions={[
        { label: msg.open, onClick: submit, disabled: value === '' },
        { label: msg.cancel, onClick: cancelPassword },
      ]}
    >
      <p>{text ?? msg.protectedFile(name)}</p>
      <div className={styles.field}>
        <label htmlFor={fieldId}>{msg.field}</label>
        <input
          id={fieldId}
          data-initial-focus="true"
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          className={styles.input}
          value={value}
          onChange={(event) => { setValue(event.target.value); }}
          onKeyDown={onKeyDown}
        />
      </div>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => { setVisible(event.target.checked); }}
        />
        <span>{msg.showPassword}</span>
      </label>
      {incorrect ? (
        <p role="alert" className={styles.error}>
          {msg.wrongPassword}
        </p>
      ) : null}
    </Dialog>
  );
}
