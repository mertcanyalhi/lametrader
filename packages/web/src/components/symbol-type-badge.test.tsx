import { describe, expect, it } from 'vitest';
import { SYMBOL_TYPE_COLOR } from './symbol-type-badge';

describe('SYMBOL_TYPE_COLOR', () => {
  it('maps each symbol type to a distinct badge colour', () => {
    expect(SYMBOL_TYPE_COLOR).toEqual({
      crypto: 'orange',
      stock: 'blue',
      fund: 'purple',
      fx: 'green',
    });
  });
});
