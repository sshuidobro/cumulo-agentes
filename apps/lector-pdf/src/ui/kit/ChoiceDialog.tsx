import { useChoice } from '../../state/choice';
import { Dialog } from './Dialog';

/** Pinta el diálogo de elección activo (`askChoice`). Sin elección activa no muestra nada. */
export function ChoiceDialog() {
  const active = useChoice((s) => s.active);
  return (
    <Dialog
      open={active !== null}
      title={active?.title ?? ''}
      actions={active?.options.map((option) => ({ label: option.label, onClick: option.pick })) ?? []}
      onClose={() => { active?.dismiss(); }}
    >
      {active?.message ? <p>{active.message}</p> : null}
    </Dialog>
  );
}
