import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalog, contarMascaras, loadLibrary } from './library.js';

const EXEMPLO_DIR = resolve(import.meta.dirname, '../../../masks-exemplo');

function dirTemp(): string {
  return mkdtempSync(join(tmpdir(), 'aero-lib-'));
}
function escreverMascara(dir: string, id: string, nome: string): void {
  writeFileSync(
    join(dir, `${id}.md`),
    `---\nid: ${id}\nmodalidade: TC\nnome: ${nome}\norigem: base\n---\nTITULO\n\nTécnica:\n\nX.\n`,
    'utf8',
  );
}

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

describe('loadLibrary em camadas', () => {
  it('camada posterior substitui máscara de mesmo id', () => {
    const base = dirTemp();
    const medico = dirTemp();
    escreverMascara(base, 'tc-cranio', 'Base');
    escreverMascara(base, 'tc-torax', 'Base tórax');
    escreverMascara(medico, 'tc-cranio', 'Do médico');
    const masks = loadLibrary([base, medico]);
    expect(masks).toHaveLength(2);
    expect(masks.find((m) => m.id === 'tc-cranio')!.nome).toBe('Do médico');
    expect(masks.find((m) => m.id === 'tc-torax')!.nome).toBe('Base tórax');
  });

  it('camada inexistente ou vazia não derruba; total zero lança', () => {
    const base = dirTemp();
    escreverMascara(base, 'tc-cranio', 'Base');
    expect(loadLibrary([base, join(base, 'nao-existe')])).toHaveLength(1);
    expect(() => loadLibrary([join(base, 'nao-existe')])).toThrow(/nenhuma máscara/);
  });

  it('id duplicado NA MESMA camada continua erro', () => {
    const base = dirTemp();
    escreverMascara(base, 'tc-cranio', 'A');
    writeFileSync(join(base, 'outra.md'), `---\nid: tc-cranio\nmodalidade: TC\nnome: B\n---\nY\n`, 'utf8');
    expect(() => loadLibrary([base])).toThrow(/duplicado/);
  });

  it('string única preserva o comportamento antigo', () => {
    const base = dirTemp();
    escreverMascara(base, 'tc-cranio', 'A');
    expect(loadLibrary(base)).toHaveLength(1);
  });
});

describe('contarMascaras', () => {
  it('conta os .md com frontmatter id válido num diretório', () => {
    const dir = dirTemp();
    escreverMascara(dir, 'tc-cranio', 'A');
    escreverMascara(dir, 'tc-torax', 'B');
    expect(contarMascaras(dir)).toBe(2);
  });

  it('diretório vazio conta zero', () => {
    expect(contarMascaras(dirTemp())).toBe(0);
  });

  it('diretório inexistente conta zero', () => {
    expect(contarMascaras(join(dirTemp(), 'nao-existe'))).toBe(0);
  });

  it('.md sem frontmatter de máscara não conta', () => {
    const dir = dirTemp();
    escreverMascara(dir, 'tc-cranio', 'A');
    writeFileSync(join(dir, 'anotacoes.md'), '# apenas anotações, sem frontmatter de máscara\n', 'utf8');
    expect(contarMascaras(dir)).toBe(1);
  });
});
