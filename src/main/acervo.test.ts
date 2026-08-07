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

const TC_CRANIO_TEXTO = 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nPaciente: JOAO DA SILVA.\nSem alterações relevantes.';

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

describe('importarAcervo — reimportar não duplica (M3)', () => {
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

  it('importar o MESMO conteúdo 2×: a segunda vez grava 0 e reporta duplicados=1', async () => {
    const arquivo = join(origem, 'laudo.txt');
    writeFileSync(arquivo, TC_CRANIO_TEXTO, 'utf8');

    const r1 = await importarAcervo([arquivo], cfg({ acervoDir }));
    expect(r1.duplicados).toBe(0);
    expect(r1.clusters.reduce((s, c) => s + c.quantidade, 0)).toBe(1);

    const r2 = await importarAcervo([arquivo], cfg({ acervoDir }));
    expect(r2.duplicados).toBe(1);
    expect(r2.clusters.reduce((s, c) => s + c.quantidade, 0)).toBe(0);
  });

  it('dois arquivos de CONTEÚDO DIFERENTE: os 2 são gravados, 0 duplicados', async () => {
    const a = join(origem, 'a.txt');
    const b = join(origem, 'b.txt');
    writeFileSync(a, TC_CRANIO_TEXTO, 'utf8');
    writeFileSync(b, 'TOMOGRAFIA COMPUTADORIZADA DO TORAX\n\nPaciente: MARIA SOUZA.\nOutro achado qualquer.', 'utf8');

    const r = await importarAcervo([a, b], cfg({ acervoDir }));
    expect(r.duplicados).toBe(0);
    expect(r.clusters.reduce((s, c) => s + c.quantidade, 0)).toBe(2);
  });

  it('o MESMO arquivo escolhido 2× no MESMO lote (drag duplicado): só grava 1, reporta 1 duplicado — dedupe também dentro do lote', async () => {
    const arquivo = join(origem, 'laudo.txt');
    writeFileSync(arquivo, TC_CRANIO_TEXTO, 'utf8');

    const r = await importarAcervo([arquivo, arquivo], cfg({ acervoDir }));
    expect(r.duplicados).toBe(1);
    expect(r.clusters.reduce((s, c) => s + c.quantidade, 0)).toBe(1);
  });

  it('reimportação PARCIALMENTE nova: 1 repetido + 1 novo → 1 gravado, 1 duplicado', async () => {
    const a = join(origem, 'a.txt');
    writeFileSync(a, TC_CRANIO_TEXTO, 'utf8');
    await importarAcervo([a], cfg({ acervoDir }));

    const bNovo = join(origem, 'b.txt');
    writeFileSync(bNovo, 'TOMOGRAFIA COMPUTADORIZADA DO TORAX\n\nPaciente: MARIA SOUZA.\nOutro achado qualquer.', 'utf8');

    const r = await importarAcervo([a, bNovo], cfg({ acervoDir }));
    expect(r.duplicados).toBe(1);
    expect(r.clusters.reduce((s, c) => s + c.quantidade, 0)).toBe(1);
  });

  it('cada arquivo entra em EXATAMENTE UM cluster: a soma das quantidades dos clusters é igual ao total de arquivos gravados, sem dupla contagem', async () => {
    const textos = [
      'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nAchado 1.',
      'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nAchado 2 (mesmo tipo, texto diferente).',
      'TOMOGRAFIA COMPUTADORIZADA DO TORAX\n\nAchado 3.',
      'TOMOGRAFIA COMPUTADORIZADA DO ABDOME\n\nAchado 4.',
    ];
    const caminhos = textos.map((t, i) => {
      const p = join(origem, `laudo-${i}.txt`);
      writeFileSync(p, t, 'utf8');
      return p;
    });

    const r = await importarAcervo(caminhos, cfg({ acervoDir }));
    const somaClusters = r.clusters.reduce((s, c) => s + c.quantidade, 0);
    const totalArquivosDosClusters = r.clusters.reduce((s, c) => s + c.arquivos.length, 0);
    expect(somaClusters).toBe(4);
    expect(totalArquivosDosClusters).toBe(4); // mesma contagem pelos dois caminhos — nenhum arquivo em 2 clusters
    // Nenhum caminho de arquivo gravado aparece em mais de um cluster.
    const todosArquivos = r.clusters.flatMap((c) => c.arquivos);
    expect(new Set(todosArquivos).size).toBe(todosArquivos.length);
  });
});

