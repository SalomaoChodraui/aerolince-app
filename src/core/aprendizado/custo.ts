/** Estimativa de custo do `destilar`/`aprender` ANTES de chamar o LLM (aviso ao médico). */
import { estimateCostUSD } from '../llm/anthropic.js';

export interface EstimativaCustoAprendizado {
  tokensEntradaAprox: number;
  custoAproxUSD: number | null;
}

/**
 * Tokens de entrada aproximados a partir do tamanho em bytes do corpus
 * (≈ 1 token / 4 bytes) mais ~500 tokens de overhead do prompt de sistema.
 * `maxTokens` é usado como proxy do output (o teto pedido ao modelo).
 */
export function estimarCustoAprendizado(
  bytesCorpus: number,
  modelo: string,
  maxTokens: number,
): EstimativaCustoAprendizado {
  const tokensEntradaAprox = Math.ceil(bytesCorpus / 4) + 500;
  const custoAproxUSD = estimateCostUSD(modelo, {
    inputTokens: tokensEntradaAprox,
    outputTokens: maxTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return { tokensEntradaAprox, custoAproxUSD };
}
