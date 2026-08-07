import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SINTESE_SYSTEM } from '../engine/prompts.js';
import type { CompleteParams, LLMProvider, LLMResult } from '../llm/types.js';
import { destilarSintese } from './sintese.js';

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

const PARES = `## Síntese da conclusão — tc-abdome-total

- corpo: Aorta de paredes irregulares, com placas ateromatosas calcificadas ao longo do seu trajeto.
  conclusão: Ateromatose aórtica, sem estenose significativa.`;

describe('destilarSintese', () => {
  let dir: string;
  let masksDir: string;
  let arquivos: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aprendizado-sintese-'));
    masksDir = join(dir, 'biblioteca');
    const a = join(dir, 'laudo1.md');
    writeFileSync(a, '---\nexame: tc-abdome-total\n---\nLaudo normal de abdome.');
    arquivos = [a];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('usa o prompt SINTESE_SYSTEM intacto e maxTokens 3000', async () => {
    const llm = fakeLLM([PARES]);
    await destilarSintese({ maskId: 'tc-abdome-total', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5' });

    expect(llm.chamadas).toHaveLength(1);
    expect(llm.chamadas[0]?.system).toEqual([{ text: SINTESE_SYSTEM, cache: true }]);
    expect(llm.chamadas[0]?.maxTokens).toBe(3000);
    expect(llm.chamadas[0]?.user).toContain('Tipo de exame: tc-abdome-total');
  });

  it('escreve em <masksDir>/_rascunhos/sintese-<maskId>.md, nunca direto em regras/', async () => {
    const llm = fakeLLM([PARES]);
    const r = await destilarSintese({ maskId: 'tc-abdome-total', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5' });

    expect(r.arquivo).toBe(join(masksDir, '_rascunhos', 'sintese-tc-abdome-total.md'));
    expect(existsSync(r.arquivo)).toBe(true);
    expect(existsSync(join(masksDir, 'regras', 'sintese-tc-abdome-total.md'))).toBe(false);
    const gravado = readFileSync(r.arquivo, 'utf8');
    expect(gravado).toContain('## Síntese da conclusão — tc-abdome-total');
    expect(gravado).toContain('- corpo:');
    expect(gravado).toContain('conclusão:');
    expect(gravado.toLowerCase()).toContain('rascunho');
    expect(r.custoUSD).not.toBeNull();
  });

  it('cancelamento: cancelado()=true ANTES da chamada de LLM → não chama o LLM nem grava', async () => {
    const llm = fakeLLM(['nunca deveria chegar aqui']);
    await expect(
      destilarSintese(
        { maskId: 'tc-abdome-total', arquivos, masksDir },
        { llm, modelo: 'claude-haiku-4-5', cancelado: () => true },
      ),
    ).rejects.toThrow();

    expect(llm.chamadas).toHaveLength(0);
    expect(existsSync(join(masksDir, '_rascunhos', 'sintese-tc-abdome-total.md'))).toBe(false);
  });

  it('o `user` enviado ao LLM carrega o corpus JÁ RE-SANITIZADO (nome plantado vira [NOME], nunca o nome cru)', async () => {
    const arquivoComNome = join(dir, 'laudo-com-nome.md');
    writeFileSync(arquivoComNome, '---\nexame: tc-abdome-total\n---\nPaciente: João da Silva.\nAteromatose aórtica.');
    const llm = fakeLLM([PARES]);

    await destilarSintese(
      { maskId: 'tc-abdome-total', arquivos: [arquivoComNome], masksDir },
      { llm, modelo: 'claude-haiku-4-5' },
    );

    const user = llm.chamadas[0]?.user ?? '';
    expect(user).toContain('[NOME]');
    expect(user).not.toMatch(/Jo[aã]o/i);
    expect(user).not.toMatch(/Silva/i);
  });
});
