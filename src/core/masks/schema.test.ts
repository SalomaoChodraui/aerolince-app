import { describe, expect, it } from 'vitest';
import { MaskFrontmatterSchema } from './schema.js';

describe('origem base', () => {
  it('aceita origem: base', () => {
    const fm = MaskFrontmatterSchema.parse({ id: 'tc-x', modalidade: 'TC', nome: 'X', origem: 'base' });
    expect(fm.origem).toBe('base');
  });
});
