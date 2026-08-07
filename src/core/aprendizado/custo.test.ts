import { describe, expect, it } from 'vitest';
import { estimarCustoAprendizado } from './custo.js';

describe('estimarCustoAprendizado', () => {
  it('tokens de entrada ≈ ceil(bytes/4) + 500 de overhead de prompt', () => {
    const r = estimarCustoAprendizado(4000, 'claude-haiku-4-5', 4000);
    expect(r.tokensEntradaAprox).toBe(4000 / 4 + 500);
  });

  it('arredonda para cima quando bytes/4 não é inteiro', () => {
    const r = estimarCustoAprendizado(4001, 'claude-haiku-4-5', 4000);
    expect(r.tokensEntradaAprox).toBe(Math.ceil(4001 / 4) + 500);
  });

  it('custo via estimateCostUSD com usage sintético (input aprox, output maxTokens, cache zerado)', () => {
    const r = estimarCustoAprendizado(4_000_000 - 500 * 4, 'claude-haiku-4-5', 1_000_000);
    // inputTokens ≈ 1_000_000, outputTokens = 1_000_000 → (1*1M + 5*1M)/1e6 = 6
    expect(r.custoAproxUSD).toBeCloseTo(6, 5);
  });

  it('modelo fora da tabela de preços → custoAproxUSD null (nunca 0 silencioso)', () => {
    const r = estimarCustoAprendizado(4000, 'modelo-misterioso', 4000);
    expect(r.custoAproxUSD).toBeNull();
  });
});
