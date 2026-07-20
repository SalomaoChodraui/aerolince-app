import type { SttUsage } from './openai.js';

// Preços públicos OpenAI (conferidos em 20/07/2026; equivalência por minuto na proposta de 19/07 §3).
// ⚠️ Executor: conferir em https://developers.openai.com/api/docs/pricing no dia da implementação
// e ajustar as constantes se divergirem — é indicador de custo, não faturamento.
const PRECOS_USD_POR_1M_TOKENS: Record<string, { audioIn: number; textIn: number; out: number }> = {
  'gpt-4o-transcribe': { audioIn: 6, textIn: 2.5, out: 10 },
  'gpt-4o-mini-transcribe': { audioIn: 3, textIn: 1.25, out: 5 },
};
const PRECOS_USD_POR_MIN: Record<string, number> = {
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
};

export function estimateSttCostUSD(
  model: string,
  medida: { usage?: SttUsage; audioMs?: number },
): number | null {
  const porToken = PRECOS_USD_POR_1M_TOKENS[model];
  if (medida.usage && porToken) {
    const u = medida.usage;
    return (
      (u.inputAudioTokens * porToken.audioIn +
        u.inputTextTokens * porToken.textIn +
        u.outputTokens * porToken.out) / 1_000_000
    );
  }
  const porMin = PRECOS_USD_POR_MIN[model];
  if (medida.audioMs !== undefined && porMin !== undefined) {
    return (medida.audioMs / 60_000) * porMin;
  }
  return null;
}
