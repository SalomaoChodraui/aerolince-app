import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESTILAR_SYSTEM } from '../engine/prompts.js';
import type { CompleteParams, LLMProvider, LLMResult } from '../llm/types.js';
import { destilarMascara } from './destilar.js';

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

describe('destilarMascara', () => {
  let dir: string;
  let masksDir: string;
  let arquivos: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aprendizado-destilar-'));
    masksDir = join(dir, 'biblioteca');
    const a = join(dir, 'laudo1.md');
    writeFileSync(a, '---\nexame: tc-cranio\n---\nLaudo normal de crânio.');
    arquivos = [a];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('usa o prompt DESTILAR_SYSTEM intacto e maxTokens 2500', async () => {
    const llm = fakeLLM(['conteudo da mascara']);
    await destilarMascara({ id: 'tc-cranio', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5' });

    expect(llm.chamadas).toHaveLength(1);
    expect(llm.chamadas[0]?.system).toEqual([{ text: DESTILAR_SYSTEM, cache: true }]);
    expect(llm.chamadas[0]?.maxTokens).toBe(2500);
    expect(llm.chamadas[0]?.model).toBe('claude-haiku-4-5');
  });

  it('escreve ATÔMICO em <masksDir>/_rascunhos/<id>.md e devolve o custo estimado', async () => {
    const llm = fakeLLM(['# TÍTULO DA MÁSCARA\n\nConteúdo.']);
    const r = await destilarMascara({ id: 'tc-cranio', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5' });

    expect(r.arquivo).toBe(join(masksDir, '_rascunhos', 'tc-cranio.md'));
    expect(existsSync(r.arquivo)).toBe(true);
    expect(readFileSync(r.arquivo, 'utf8')).toBe('# TÍTULO DA MÁSCARA\n\nConteúdo.\n');
    expect(r.custoUSD).not.toBeNull();
  });

  it('remove cercas de código markdown da resposta antes de gravar', async () => {
    const llm = fakeLLM(['```markdown\n# TÍTULO\n\nConteúdo.\n```']);
    const r = await destilarMascara({ id: 'tc-cranio', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5' });

    const gravado = readFileSync(r.arquivo, 'utf8');
    expect(gravado).not.toContain('```');
    expect(gravado).toBe('# TÍTULO\n\nConteúdo.\n');
  });

  it('cancelamento: cancelado()=true ANTES da chamada de LLM → não chama o LLM nem grava', async () => {
    const llm = fakeLLM(['nunca deveria chegar aqui']);
    await expect(
      destilarMascara(
        { id: 'tc-cranio', arquivos, masksDir },
        { llm, modelo: 'claude-haiku-4-5', cancelado: () => true },
      ),
    ).rejects.toThrow();

    expect(llm.chamadas).toHaveLength(0);
    expect(existsSync(join(masksDir, '_rascunhos', 'tc-cranio.md'))).toBe(false);
  });

  it('cancelamento entre duas chamadas: 1ª passa, cancelado()=true antes da 2ª → a 2ª não é escrita', async () => {
    const llm = fakeLLM(['primeira máscara', 'segunda máscara (não deveria gravar)']);
    let chamada = 0;
    const cancelado = () => {
      chamada++;
      return chamada > 1; // false na 1ª verificação, true da 2ª em diante
    };

    const r1 = await destilarMascara(
      { id: 'primeira', arquivos, masksDir },
      { llm, modelo: 'claude-haiku-4-5', cancelado },
    );
    expect(existsSync(r1.arquivo)).toBe(true);

    await expect(
      destilarMascara({ id: 'segunda', arquivos, masksDir }, { llm, modelo: 'claude-haiku-4-5', cancelado }),
    ).rejects.toThrow();

    expect(llm.chamadas).toHaveLength(1); // só a 1ª chamada de LLM aconteceu
    expect(existsSync(join(masksDir, '_rascunhos', 'segunda.md'))).toBe(false);
  });

  it('chama onProgresso durante o processamento', async () => {
    const llm = fakeLLM(['conteudo']);
    const eventos: { etapa: string; atual: number; total: number }[] = [];
    await destilarMascara(
      { id: 'tc-cranio', arquivos, masksDir },
      { llm, modelo: 'claude-haiku-4-5', onProgresso: (p) => eventos.push(p) },
    );
    expect(eventos.length).toBeGreaterThan(0);
  });
});
