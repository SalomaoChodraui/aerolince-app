import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { corpusPorArquivos, corpusPorPrefixos, montarCorpus } from './corpus.js';

describe('corpusPorPrefixos', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aprendizado-corpus-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('filtra por prefixo, ordena e devolve caminhos ABSOLUTOS, mais recentes por último', () => {
    writeFileSync(join(dir, 'tc-cranio_2026-01-01_001.md'), 'laudo 1');
    writeFileSync(join(dir, 'tc-cranio_2026-01-02_002.md'), 'laudo 2');
    writeFileSync(join(dir, 'outro-exame_2026-01-01_001.md'), 'laudo outro');

    const r = corpusPorPrefixos(dir, ['tc-cranio'], 10);

    expect(r).toEqual([join(dir, 'tc-cranio_2026-01-01_001.md'), join(dir, 'tc-cranio_2026-01-02_002.md')]);
  });

  it('aplica o cap mantendo os mais recentes (últimos após ordenação)', () => {
    writeFileSync(join(dir, 'tc-cranio_2026-01-01_001.md'), 'laudo 1');
    writeFileSync(join(dir, 'tc-cranio_2026-01-02_002.md'), 'laudo 2');
    writeFileSync(join(dir, 'tc-cranio_2026-01-03_003.md'), 'laudo 3');

    const r = corpusPorPrefixos(dir, ['tc-cranio'], 2);

    expect(r).toEqual([join(dir, 'tc-cranio_2026-01-02_002.md'), join(dir, 'tc-cranio_2026-01-03_003.md')]);
  });

  it('filtro "contendo": só inclui arquivos cujo texto contém a substring', () => {
    writeFileSync(join(dir, 'tc-abdome_2026-01-01_001.md'), 'com contraste intravenoso');
    writeFileSync(join(dir, 'tc-abdome_2026-01-02_002.md'), 'sem contraste');

    const r = corpusPorPrefixos(dir, ['tc-abdome'], 10, { contendo: 'contraste intravenoso' });

    expect(r).toEqual([join(dir, 'tc-abdome_2026-01-01_001.md')]);
  });

  it('filtro "sem": exclui arquivos cujo texto contém a substring', () => {
    writeFileSync(join(dir, 'tc-abdome_2026-01-01_001.md'), 'com contraste intravenoso');
    writeFileSync(join(dir, 'tc-abdome_2026-01-02_002.md'), 'sem contraste');

    const r = corpusPorPrefixos(dir, ['tc-abdome'], 10, { sem: 'contraste intravenoso' });

    expect(r).toEqual([join(dir, 'tc-abdome_2026-01-02_002.md')]);
  });
});

describe('corpusPorArquivos', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aprendizado-corpus-arquivos-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('valida existência: lança erro claro quando um arquivo não existe', () => {
    const a = join(dir, 'a.md');
    writeFileSync(a, 'laudo a');
    const inexistente = join(dir, 'nao-existe.md');
    expect(() => corpusPorArquivos([a, inexistente], 10)).toThrow(/nao-existe\.md/);
  });

  it('aplica o cap pelo FIM da lista', () => {
    const arquivos = ['a.md', 'b.md', 'c.md'].map((f) => join(dir, f));
    arquivos.forEach((f) => writeFileSync(f, 'laudo'));
    expect(corpusPorArquivos(arquivos, 2)).toEqual(arquivos.slice(-2));
  });

  it('sem cap efetivo (cap >= tamanho): devolve todos na mesma ordem', () => {
    const arquivos = ['a.md', 'b.md'].map((f) => join(dir, f));
    arquivos.forEach((f) => writeFileSync(f, 'laudo'));
    expect(corpusPorArquivos(arquivos, 10)).toEqual(arquivos);
  });
});

describe('montarCorpus', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aprendizado-corpus-montar-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('junta os corpos com separador "─── LAUDO N ───" e devolve o total', () => {
    const a = join(dir, 'a.md');
    const b = join(dir, 'b.md');
    writeFileSync(a, '---\nexame: tc-cranio\n---\nCorpo A sanitizado.\n');
    writeFileSync(b, '---\nexame: tc-cranio\n---\nCorpo B sanitizado.\n');

    const r = montarCorpus([a, b]);

    expect(r.total).toBe(2);
    expect(r.corpus).toBe('─── LAUDO 1 ───\nCorpo A sanitizado.\n\n─── LAUDO 2 ───\nCorpo B sanitizado.');
  });

  it('lê arquivo legado SEM frontmatter por inteiro (via corpoDoArquivo)', () => {
    const legado = join(dir, 'legado.txt');
    const bruto = 'TEXTO LEGADO INTEIRO\nSem frontmatter algum.';
    writeFileSync(legado, bruto);

    const r = montarCorpus([legado]);

    expect(r.corpus).toBe(`─── LAUDO 1 ───\n${bruto}`);
  });

  it('RE-SANITIZA cada corpo (defesa em profundidade): nome de paciente plantado vira [NOME]', () => {
    const arquivo = join(dir, 'plantado.md');
    // Simula um laudo que escapou da sanitização original (defesa em profundidade)
    writeFileSync(arquivo, '---\nexame: tc-cranio\n---\nPaciente: João da Silva.\nSem alterações.');

    const r = montarCorpus([arquivo]);

    expect(r.corpus).toContain('[NOME]');
    expect(r.corpus).not.toMatch(/Jo[aã]o/i);
    expect(r.corpus).not.toMatch(/Silva/i);
  });
});
