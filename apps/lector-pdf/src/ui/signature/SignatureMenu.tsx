import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { SignatureArt } from '../../core/annotations/model';
import type { StoredSignature } from '../../core/signature/stored';
import { deleteSignature, ensureSignaturesLoaded, useSignatures } from '../../state/signature-actions';
import { MenuButton, type MenuEntry } from '../kit/MenuButton';
import { IconSignature } from '../icons';
import { signatureMsg } from '../messages-signature';
import { signatureThumbnailUrl } from './thumbnail';

// Diálogo diferido (ADR-0027): solo se descarga al pulsar «Crear firma…».
const SignatureDialog = lazy(() => import('./SignatureDialog').then((m) => ({ default: m.SignatureDialog })));

export interface SignatureMenuProps {
  /** Firma elegida: una guardada, o la recién creada en «Crear firma…». */
  readonly onPick: (art: SignatureArt) => void;
  /** Sin documento abierto no se puede firmar. */
  readonly disabled?: boolean;
}

/** Menú de firmas (PDF-086): firmas guardadas como miniaturas, «Crear firma…» y el borrado de cada una. */
export function SignatureMenu({ onPick, disabled = false }: SignatureMenuProps) {
  const list = useSignatures((s) => s.list);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    ensureSignaturesLoaded();
  }, []);

  const entries = useMemo(() => menuEntries(list, onPick, () => { setCreating(true); }), [list, onPick]);

  return (
    <>
      <MenuButton label={signatureMsg.menuLabel} entries={entries} disabled={disabled}>
        <IconSignature />
      </MenuButton>
      {creating && (
        <Suspense fallback={null}>
          <SignatureDialog
            open={creating}
            onDone={(art) => {
              setCreating(false);
              onPick(art);
            }}
            onCancel={() => { setCreating(false); }}
          />
        </Suspense>
      )}
    </>
  );
}

function menuEntries(
  list: readonly StoredSignature[],
  onPick: (art: SignatureArt) => void,
  onCreate: () => void,
): readonly MenuEntry[] {
  const picks: MenuEntry[] = list.map((stored, index) => {
    const label = signatureMsg.savedName(index + 1);
    const thumbnail = signatureThumbnailUrl(stored.art);
    return thumbnail === null
      ? { kind: 'action', label, onSelect: () => { onPick(stored.art); } }
      : { kind: 'action', label, thumbnail, onSelect: () => { onPick(stored.art); } };
  });
  const deletes: MenuEntry[] = list.map((stored, index) => ({
    kind: 'action',
    label: signatureMsg.deleteSaved(index + 1),
    onSelect: () => { deleteSignature(stored.id); },
  }));
  return [
    ...picks,
    ...(picks.length > 0 ? (['separator'] as const) : []),
    { kind: 'action', label: signatureMsg.createSignature, onSelect: onCreate },
    ...(deletes.length > 0 ? (['separator'] as const) : []),
    ...deletes,
  ];
}
