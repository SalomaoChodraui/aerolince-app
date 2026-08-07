import { describe, expect, it } from 'vitest';
import type { CompleteParams, LLMProvider, LLMResult } from '../llm/types.js';
import type { Mask } from '../masks/schema.js';
import { refine } from './engine.js';

const USAGE = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };

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

/** Máscara fictícia no formato real de abdome (blocos + Conclusão:). */
const MASK_BODY = `TOMOGRAFIA COMPUTADORIZADA DE ABDOME E PELVE

Técnica:

Imagens volumétricas obtidas sem a administração intravenosa de meio de contraste iodado.

Análise:

<!-- orgao: figado -->
Fígado com dimensões normais, contornos regulares e atenuação preservada.

<!-- orgao: rins -->
Rins tópicos, de dimensões e contornos habituais.

<!-- orgao: apendice -->
Apêndice cecal visualizado, sem sinais inflamatórios.

<!-- orgao: bexiga -->
Bexiga pouco repleta, de avaliação prejudicada.

Conclusão:

<!-- impressao -->
Exame sem alterações significativas.`;

const mask: Mask = {
  id: 'tc-abdome-teste',
  modalidade: 'TC',
  regiao: ['abdome', 'pelve'],
  nome: 'TC de Abdome e Pelve (teste)',
  sinonimos: [],
  contraste: 'sem',
  versao: 1,
  origem: 'manual',
  prefixos: [],
  body: MASK_BODY,
  filePath: '/fake/tc-abdome-teste.md',
};

const params = {
  mask,
  currentReportRaw: MASK_BODY,
  command: 'coloca que tem derrame pleural à direita',
  profileName: 'padrao',
  profileBody: 'sem instruções extras',
  model: 'claude-fake',
};

describe('refine — achado fora da região do exame (defeito de campo)', () => {
  it('resposta com @@ achado-adicional produz a seção no lugar certo, sem meta-texto', async () => {
    const llm = fakeLLM([
      '@@ achado-adicional\nDerrame pleural à direita.\n@@ substituir: impressao\nDerrame pleural à direita.',
    ]);
    const r = await refine(llm, params);

    // A seção existe, ao final da Análise, imediatamente antes da Conclusão
    expect(r.report).toContain('Achados adicionais:\nDerrame pleural à direita.\n\nConclusão:');
    expect(r.report.indexOf('Achados adicionais:')).toBeGreaterThan(
      r.report.indexOf('Bexiga pouco repleta'),
    );
    // O achado ditado também entrou na Conclusão
    expect(r.report).toContain('Conclusão:\n\nDerrame pleural à direita.');
    // Laudo pronto para clipboard: sem marcador, sem nota de processo
    expect(r.report).not.toContain('<!--');
    expect(r.report).not.toContain('bloco removido');
    // Rastreável como os demais blocos
    expect(r.diff.changed).toContain('achados-adicionais');
    expect(r.diff.changed).toContain('impressao');
    // O reportRaw mantém o marcador para refinos futuros
    expect(r.reportRaw).toContain('<!-- orgao: achados-adicionais -->');
  });

  it('resposta com nota de processo é bloqueada pelo validador e refeita', async () => {
    const llm = fakeLLM([
      // 1ª tentativa: o comportamento do defeito de campo — nota de processo no corpo
      '@@ substituir: apendice\n(bloco removido — não é achado abdominal/pélvico)\n@@ substituir: impressao\nDerrame pleural à direita.',
      // 2ª tentativa: o comportamento correto
      '@@ achado-adicional\nDerrame pleural à direita.\n@@ substituir: impressao\nDerrame pleural à direita.',
    ]);
    const r = await refine(llm, params);

    expect(llm.chamadas).toHaveLength(2);
    expect(llm.chamadas[1]!.user).toContain('resposta anterior era inválida');
    expect(r.report).not.toContain('bloco removido');
    expect(r.report).toContain('Achados adicionais:\nDerrame pleural à direita.');
  });

  it('@@ remover apaga o bloco pedido sem deixar nota no lugar', async () => {
    const llm = fakeLLM(['@@ remover: apendice']);
    const r = await refine(llm, { ...params, command: 'tira a frase do apêndice' });

    expect(r.report).not.toContain('Apêndice cecal');
    expect(r.report).not.toContain('(');
    expect(r.report).toContain('Rins tópicos, de dimensões e contornos habituais.\n\nBexiga pouco repleta');
    expect(r.diff.changed).toContain('apendice');
  });
});
