/** Textos del diálogo «Contraseña necesaria» (PDF-046) y de los permisos del documento (PDF-048). */
export const securityMsg = {
  title: 'Contraseña necesaria',
  protectedFile: (name: string): string => `“${name}” está protegido. Escribe la contraseña para abrirlo.`,
  field: 'Contraseña',
  showPassword: 'Mostrar contraseña',
  wrongPassword: 'La contraseña no es correcta.',
  open: 'Abrir',
  cancel: 'Cancelar',
  /** Copiar texto no permitido: aviso al intentarlo y explicación del botón «Copiar» deshabilitado. */
  copyBlocked: 'El autor de este PDF no permite copiar su texto.',
  /** Imprimir no permitido: aviso con Ctrl+P y explicación del botón deshabilitado. */
  printBlocked: 'El autor de este PDF no permite imprimirlo.',
  /** Solo la alta calidad no permitida: la impresión sale a 150 ppp. */
  highQualityBlocked: 'El autor de este PDF no permite la alta calidad: se imprimirá a 150 ppp.',
  /** Aviso una vez por documento al crear un cambio cuando el PDF no permite comentar o rellenar. */
  annotateAnyway: 'Este PDF no permite comentarios; tus cambios se guardarán igualmente en tu copia.',
  /** Pestaña «Seguridad» de Propiedades (PDF-048). */
  tabSecurity: 'Seguridad',
  cipherLabel: 'Cifrado',
  ciphers: {
    none: 'Ninguno',
    'rc4-40': 'RC4 40 bits',
    'rc4-128': 'RC4 128 bits',
    'aes-128': 'AES 128 bits',
    'aes-256': 'AES 256 bits',
  },
  permissionsLabel: 'Permisos',
  allowed: 'Permitido',
  notAllowed: 'No permitido',
  permissionRows: {
    print: 'Imprimir',
    printHighQuality: 'Imprimir en alta calidad',
    copy: 'Copiar',
    annotate: 'Comentar',
    fillForms: 'Rellenar formularios',
    assemble: 'Montar el documento',
    modify: 'Modificar el contenido',
  },
} as const;
