import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalog, loadLibrary } from './library.js';

const EXEMPLO_DIR = resolve(import.meta.dirname, '../../../masks-exemplo');

describe('loadLibrary', () => {
  it('carrega as máscaras de exemplo com frontmatter válido', () => {
    const masks = loadLibrary(EXEMPLO_DIR);
    expect(masks.length).toBeGreaterThan(0);
    const abdome = masks.find((m) => m.id === 'tc-exemplo-abdome');
    expect(abdome).toBeDefined();
    expect(abdome!.modalidade).toBe('TC');
    expect(abdome!.body).toContain('<!-- orgao:');
  });

  it('ignora .md sem frontmatter de máscara (anotações na pasta)', () => {
    const masks = loadLibrary(EXEMPLO_DIR);
    expect(masks.every((m) => typeof m.id === 'string' && m.id.length > 0)).toBe(true);
  });

  it('monta catálogo compacto de uma linha por máscara', () => {
    const masks = loadLibrary(EXEMPLO_DIR);
    const catalog = buildCatalog(masks);
    expect(catalog.split('\n')).toHaveLength(masks.length);
    expect(catalog).toContain('tc-exemplo-abdome');
  });
});
