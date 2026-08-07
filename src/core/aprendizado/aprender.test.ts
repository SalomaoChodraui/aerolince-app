import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APRENDER_SYSTEM } from '../engine/prompts.js';
import type { CompleteParams, LLMProvider, LLMResult } from '../llm/types.js';
import { aprenderRegras } from './aprender.js';

const USAGE = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeLLM(respostas: (string | LLMResult)[]): LLMProvider & { chamadas: CompleteParams[] } {
  const chamadas: CompleteParams[] = [];
  let i = 0;
  return {
    chamadas,
    async complete(params) {
      chamadas.push(params);
      const r = respostas[i++];
      if (r === undefined) throw new Error('fakeLLM: sem resposta programada para esta chamada');
      return typeof r === 'string' ? { text: r, usage: USAGE } : r;
    },
  };
}

describe('aprenderRegras', () => {
  let dir: string;
  let masksDir: string;
  let arquivos: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aprendizado-aprender-'));
    masksDir = join(dir, 'biblioteca');
    const a = join(dir, 'laudo1.md');
    writeFileSync(a, '---\nexame: tc-cranio\n---\nLaudo normal de crânio.');
    arquivos = [a];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('usa o prompt APRENDER_SYSTEM intacto e maxTokens 4000', async () => {
    const llm = fakeLLM(['regras extraidas']);
    await aprenderRegras({ maskId: 'tc-cranio', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5' });

    expect(llm.chamadas).toHaveLength(1);
    expect(llm.chamadas[0]?.system).toEqual([{ text: APRENDER_SYSTEM, cache: true }]);
    expect(llm.chamadas[0]?.maxTokens).toBe(4000);
  });

  it('MUDANÇA DE COMPORTAMENTO: escreve em <masksDir>/_rascunhos/regras-<maskId>.md, nunca direto em regras/', async () => {
    const llm = fakeLLM(['## Limites do protocolo\n\nnada.']);
    const r = await aprenderRegras({ maskId: 'tc-cranio', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5' });

    expect(r.arquivo).toBe(join(masksDir, '_rascunhos', 'regras-tc-cranio.md'));
    expect(existsSync(r.arquivo)).toBe(true);
    expect(existsSync(join(masksDir, 'regras', 'tc-cranio.md'))).toBe(false);
    const gravado = readFileSync(r.arquivo, 'utf8');
    expect(gravado).toContain('## Limites do protocolo');
    expect(gravado.toLowerCase()).toContain('rascunho');
    expect(r.custoUSD).not.toBeNull();
  });

  it('cancelamento: cancelado()=true ANTES da chamada de LLM → não chama o LLM nem grava', async () => {
    const llm = fakeLLM(['nunca deveria chegar aqui']);
    await expect(
      aprenderRegras(
        { maskId: 'tc-cranio', arquivos, masksDir },
        { llm, modelo: 'claude-haiku-4-5', cancelado: () => true },
      ),
    ).rejects.toThrow();

    expect(llm.chamadas).toHaveLength(0);
    expect(existsSync(join(masksDir, '_rascunhos', 'regras-tc-cranio.md'))).toBe(false);
  });

  it('cancelamento entre duas chamadas: 1ª passa, cancelado()=true antes da 2ª → a 2ª não é escrita', async () => {
    const llm = fakeLLM(['regras 1', 'regras 2 (não deveria gravar)']);
    let chamada = 0;
    const cancelado = () => {
      chamada++;
      return chamada > 1;
    };

    const r1 = await aprenderRegras(
      { maskId: 'tc-cranio', arquivos, masksDir },
      { llm, modelo: 'claude-haiku-4-5', cancelado },
    );
    expect(existsSync(r1.arquivo)).toBe(true);

    await expect(
      aprenderRegras({ maskId: 'tc-abdome', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5', cancelado }),
    ).rejects.toThrow();

    expect(llm.chamadas).toHaveLength(1);
    expect(existsSync(join(masksDir, '_rascunhos', 'regras-tc-abdome.md'))).toBe(false);
  });
});
