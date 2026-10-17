import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE_NAME } from '../src/index';

describe('@suite/shared', () => {
  it('expone el nombre del paquete', () => {
    expect(SHARED_PACKAGE_NAME).toBe('@suite/shared');
  });
});
