/**
 * Permisos del documento (PDF-048) y tipo de cifrado. Puro: sin pdf.js ni React.
 * Las banderas son las de `/P` (ISO 32000-1 tabla 22), tal como las expone `doc.getPermissions()`.
 */
import type { SecurityHandler } from './pdf/crypto';

/** Banderas de `/P` que usa la aplicación. */
export const PERMISSION_FLAG = {
  PRINT: 4,
  MODIFY_CONTENTS: 8,
  COPY: 16,
  MODIFY_ANNOTATIONS: 32,
  FILL_INTERACTIVE_FORMS: 256,
  ASSEMBLE: 1024,
  PRINT_HIGH_QUALITY: 2048,
} as const;

/** Lo que el documento permite hacer. Cada campo es `true` si la acción está permitida. */
export interface DocPermissions {
  readonly copy: boolean;
  readonly print: boolean;
  readonly printHighQuality: boolean;
  readonly annotate: boolean;
  readonly fillForms: boolean;
  readonly assemble: boolean;
  readonly modify: boolean;
}

/** Sin restricciones: lo que se usa mientras no se conocen los permisos y cuando el PDF no tiene `/Encrypt`. */
export const ALL_PERMISSIONS: DocPermissions = {
  copy: true,
  print: true,
  printHighQuality: true,
  annotate: true,
  fillForms: true,
  assemble: true,
  modify: true,
};

/**
 * Permisos a partir de las banderas de `/P`. `null` (sin restricciones) da todo permitido.
 * Rellenar formularios se permite con la bandera 256 o con la 32 (comentar), como en Adobe Reader.
 */
export function permissionsFrom(flags: ReadonlySet<number> | null): DocPermissions {
  if (flags === null) return ALL_PERMISSIONS;
  const has = (flag: number): boolean => flags.has(flag);
  return {
    copy: has(PERMISSION_FLAG.COPY),
    print: has(PERMISSION_FLAG.PRINT),
    printHighQuality: has(PERMISSION_FLAG.PRINT_HIGH_QUALITY),
    annotate: has(PERMISSION_FLAG.MODIFY_ANNOTATIONS),
    fillForms: has(PERMISSION_FLAG.FILL_INTERACTIVE_FORMS) || has(PERMISSION_FLAG.MODIFY_ANNOTATIONS),
    assemble: has(PERMISSION_FLAG.ASSEMBLE),
    modify: has(PERMISSION_FLAG.MODIFY_CONTENTS),
  };
}

/** Cifrado del fichero, como se muestra en Propiedades › Seguridad. */
export type CipherKind = 'none' | 'rc4-40' | 'rc4-128' | 'aes-128' | 'aes-256';

/**
 * Cifrado a partir del manejador de seguridad abierto. `null` (sin `/Encrypt`) es `none`.
 * RC4: 40 bits si la clave tiene 5 bytes o menos; en otro caso, 128 bits.
 */
export function cipherKindOf(security: SecurityHandler | null): CipherKind {
  if (security === null) return 'none';
  const method = security.streamMethod !== 'none' ? security.streamMethod : security.stringMethod;
  switch (method) {
    case 'none':
      return 'none';
    case 'aes256':
      return 'aes-256';
    case 'aes128':
      return 'aes-128';
    case 'rc4':
      return security.fileKey.length <= 5 ? 'rc4-40' : 'rc4-128';
  }
}
