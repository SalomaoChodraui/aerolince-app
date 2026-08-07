import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extrairTexto } from './extrair.js';

const FX = resolve(import.meta.dirname, 'fixtures');

describe('extrairTexto', () => {
  it('extrai texto de PDF sintético', async () => {
    const r = await extrairTexto(resolve(FX, 'mini.pdf'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.texto).toContain('TOMOGRAFIA COMPUTADORIZADA');
  });

  it('extrai texto de DOCX sintético', async () => {
    const r = await extrairTexto(resolve(FX, 'mini.docx'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.texto).toContain('TOMOGRAFIA COMPUTADORIZADA');
  });

  it('extrai TXT direto', async () => {
    const r = await extrairTexto(resolve(FX, 'mini.txt'));
    expect(r.ok && r.texto.includes('TOMOGRAFIA')).toBe(true);
  });

  describe('casos de erro', () => {
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('arquivo inexistente → erro', async () => {
      expect(await extrairTexto('/nao/existe.pdf')).toMatchObject({ ok: false, motivo: 'erro' });
    });

    it('extensão desconhecida → formato', async () => {
      expect(await extrairTexto(resolve(FX, 'mini.txt').replace('.txt', '.xyz'))).toMatchObject({
        ok: false,
        motivo: 'formato',
      });
    });

    it('arquivo com pouco texto útil → sem-texto (nunca descartado em silêncio)', async () => {
      dir = mkdtempSync(join(tmpdir(), 'acervo-extrair-'));
      const caminho = join(dir, 'curto.txt');
      writeFileSync(caminho, 'so 10c.', 'utf8');
      expect(await extrairTexto(caminho)).toMatchObject({ ok: false, motivo: 'sem-texto' });
    });
  });
});
