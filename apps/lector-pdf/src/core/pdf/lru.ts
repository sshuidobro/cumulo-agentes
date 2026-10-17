/**
 * Caché LRU mínima: `get` y `set` renuevan la entrada; al superar la capacidad se descarta
 * la menos usada recientemente. Sin lógica de E/S.
 */
export class Lru<K, V> {
  private readonly map = new Map<K, V>();
  private readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(`Lru: la capacidad debe ser un entero >= 1 (recibido ${capacity})`);
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.map.size;
  }

  /** Devuelve el valor y lo marca como el más reciente. `undefined` si no está. */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
}
