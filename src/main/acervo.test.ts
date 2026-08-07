import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema, type Config } from '../core/config/schema.js';
import { contadoresExistentes, importarAcervo } from './acervo.js';

/** Config mínima o bastante para `importarAcervo` — mesmo padrão de `aprendizado.test.ts`. */
function cfg(o: { acervoDir: string }): Config {
  return ConfigSchema.parse({
    masksDir: '/tmp/aerolince-testes-nao-existe-masks',
    profilesDir: '/x',
    outputDir: '/tmp/aerolince-testes-nao-existe-output',
    bibliotecaBaseDir: '/tmp/aerolince-testes-nao-existe-base',
    acervoDir: o.acervoDir,
    stt: {},
    llm: {},
  });
}

describe('contadoresExistentes (M2 — próximo índice por MAX+1, não por contagem)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aerolince-acervo-contadores-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('com um arquivo do meio apagado (001 e 003 existentes, 002 removido), o contador é o MAX (3) — não a contagem (2), que faria o próximo índice (3) colidir e sobrescrever o 003 existente', () => {
    writeFileSync(join(dir, 'tc-cranio_2026-01-01_001.md'), 'a', 'utf8');
    writeFileSync(join(dir, 'tc-cranio_2026-01-05_003.md'), 'b', 'utf8');

    const contagem = contadoresExistentes(dir);

    expect(contagem.get('tc-cranio')).toBe(3);
  });

  it('múltiplas chaves: cada uma tem seu próprio MAX, independente das demais', () => {
    writeFileSync(join(dir, 'tc-cranio_2026-01-01_001.md'), 'a', 'utf8');
    writeFileSync(join(dir, 'tc-cranio_2026-01-05_005.md'), 'b', 'utf8');
    writeFileSync(join(dir, 'tc-abdome_2026-01-01_001.md'), 'c', 'utf8');
    writeFileSync(join(dir, 'tc-abdome_2026-01-02_002.md'), 'd', 'utf8');

    const contagem = contadoresExistentes(dir);

    expect(contagem.get('tc-cranio')).toBe(5);
    expect(contagem.get('tc-abdome')).toBe(2);
  });

  it('ignora arquivos que não seguem o padrão do acervo', () => {
    writeFileSync(join(dir, 'nao-e-do-padrao.txt'), 'x', 'utf8');
    writeFileSync(join(dir, '_mapa-local.tsv'), 'x', 'utf8');
    expect(contadoresExistentes(dir).size).toBe(0);
  });

  it('diretório inexistente devolve mapa vazio', () => {
    expect(contadoresExistentes(join(dir, 'nao-existe')).size).toBe(0);
  });
});

describe('importarAcervo — arrastar PASTA (I-wizard-1)', () => {
  let origem: string;
  let acervoDir: string;

  beforeEach(() => {
    origem = mkdtempSync(join(tmpdir(), 'aerolince-acervo-origem-'));
    acervoDir = mkdtempSync(join(tmpdir(), 'aerolince-acervo-destino-'));
  });

  afterEach(() => {
    rmSync(origem, { recursive: true, force: true });
    rmSync(acervoDir, { recursive: true, force: true });
  });

  it('caminho de PASTA (arraste) é expandido para os arquivos aceitos diretamente dentro dela, sem recursão', () => {
    writeFileSync(join(origem, 'a.txt'), 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nAchado 1, sem alterações relevantes.', 'utf8');
    writeFileSync(join(origem, 'b.txt'), 'TOMOGRAFIA COMPUTADORIZADA DO TORAX\n\nAchado 2, sem alterações relevantes.', 'utf8');
    writeFileSync(join(origem, 'ignorar.jpg'), 'não é laudo', 'utf8');
    mkdirSync(join(origem, 'subpasta'));
    writeFileSync(join(origem, 'subpasta', 'c.txt'), 'TOMOGRAFIA COMPUTADORIZADA DO ABDOME TOTAL\n\nnão deve entrar (subpasta).', 'utf8');

    return importarAcervo([origem], cfg({ acervoDir })).then((r) => {
      const totalGravado = r.clusters.reduce((soma, c) => soma + c.quantidade, 0);
      expect(totalGravado).toBe(2); // a.txt + b.txt — nem o .jpg, nem o arquivo da subpasta
      expect(r.semTexto).not.toContain('c.txt');
    });
  });

  it('mistura de PASTA + arquivo solto no mesmo array de caminhos — ambos processados', async () => {
    writeFileSync(join(origem, 'd.txt'), 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nAchado da pasta.', 'utf8');
    const solto = join(origem, '..', `solto-${Date.now()}.txt`);
    writeFileSync(solto, 'TOMOGRAFIA COMPUTADORIZADA DO TORAX\n\nAchado solto, fora da pasta.', 'utf8');
    try {
      const r = await importarAcervo([origem, solto], cfg({ acervoDir }));
      const totalGravado = r.clusters.reduce((soma, c) => soma + c.quantidade, 0);
      expect(totalGravado).toBe(2);
    } finally {
      rmSync(solto, { force: true });
    }
  });
});

