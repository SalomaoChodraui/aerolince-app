import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contadoresExistentes } from './acervo.js';

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
