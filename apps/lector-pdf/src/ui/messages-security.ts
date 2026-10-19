/** Textos del diálogo «Contraseña necesaria» (PDF-046). */
export const securityMsg = {
  title: 'Contraseña necesaria',
  protectedFile: (name: string): string => `“${name}” está protegido. Escribe la contraseña para abrirlo.`,
  field: 'Contraseña',
  showPassword: 'Mostrar contraseña',
  wrongPassword: 'La contraseña no es correcta.',
  open: 'Abrir',
  cancel: 'Cancelar',
} as const;
