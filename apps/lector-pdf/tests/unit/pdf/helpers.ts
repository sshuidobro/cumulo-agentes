/** Bytes ASCII/UTF-8 de un texto de prueba. */
export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Bytes crudos para casos binarios. */
export function raw(values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** Texto de los bytes en latín-1 (1 carácter por byte), para comparar contenidos binarios en los tests. */
export function latin1(data: Uint8Array): string {
  return String.fromCharCode(...data);
}
