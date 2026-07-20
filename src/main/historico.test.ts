import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { apagarLaudo, apagarTodosLaudos, contarLaudos, vencidos } from './historico.js';

describe('vencidos (decisão pura da retenção)', () => {
  const dia = 24 * 60 * 60 * 1000;
  const agora = 1_000_000_000_000;

  it('retencaoDias 0 nunca vence, mesmo com arquivos antiquíssimos', () => {
    expect(vencidos([{ path: 'a.txt', mtimeMs: 0 }], 0, agora)).toEqual([]);
  });

  it('corte exato: arquivo na fronteira é preservado; só o estritamente mais antigo vence', () => {
    const corte = agora - 10 * dia;
    const arquivos = [
      { path: 'exato.txt', mtimeMs: corte }, // exatamente no corte → mantém
      { path: 'velho.txt', mtimeMs: corte - 1 }, // além do prazo → vence
      { path: 'novo.txt', mtimeMs: corte + 1 }, // dentro do prazo → mantém
    ];
    expect(vencidos(arquivos, 10, agora)).toEqual(['velho.txt']);
  });

  it('lista vazia devolve vazio', () => {
    expect(vencidos([], 30, agora)).toEqual([]);
  });
});

describe('apagarLaudo / apagarTodosLaudos', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aerolince-hist-'));
  });

  function criar(nome: string) {
    writeFileSync(join(dir, `${nome}.txt`), 'laudo', 'utf8');
    writeFileSync(join(dir, `${nome}.json`), '{}', 'utf8');
  }

  it('apaga o par .txt + sidecar .json de um laudo', () => {
    criar('2026-07-20_1430_abdome');
    expect(apagarLaudo(dir, '2026-07-20_1430_abdome.txt')).toBe(true);
    expect(existsSync(join(dir, '2026-07-20_1430_abdome.txt'))).toBe(false);
    expect(existsSync(join(dir, '2026-07-20_1430_abdome.json'))).toBe(false);
  });

  it('laudo inexistente devolve false', () => {
    expect(apagarLaudo(dir, 'nao-existe.txt')).toBe(false);
  });

  it('path traversal: identificador aponta para fora → nada fora de outputDir é tocado', () => {
    const fora = mkdtempSync(join(tmpdir(), 'aerolince-fora-'));
    const alvoFora = join(fora, 'segredo.txt');
    writeFileSync(alvoFora, 'nao apague', 'utf8');
    // Caminho absoluto E relativo com ../ — basename reduz ambos ao nome e procura DENTRO de dir.
    expect(apagarLaudo(dir, alvoFora)).toBe(false);
    expect(apagarLaudo(dir, join('..', '..', fora, 'segredo.txt'))).toBe(false);
    expect(existsSync(alvoFora)).toBe(true); // intacto
  });

  it('apagarTodosLaudos remove todos os pares e devolve a contagem', () => {
    criar('a');
    criar('b');
    expect(contarLaudos(dir)).toBe(2);
    expect(apagarTodosLaudos(dir)).toBe(2);
    expect(contarLaudos(dir)).toBe(0);
    expect(existsSync(join(dir, 'a.json'))).toBe(false);
    expect(existsSync(join(dir, 'b.txt'))).toBe(false);
  });
});
