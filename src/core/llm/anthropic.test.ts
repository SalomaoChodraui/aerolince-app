import { describe, expect, it } from 'vitest';
import { estimateCostUSD } from './anthropic.js';

const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('estimateCostUSD', () => {
  it('conhece a família gpt-5 (prefixos mais específicos primeiro)', () => {
    expect(estimateCostUSD('gpt-5-mini', usage)).toBeCloseTo(0.25 + 2.0, 5);
    expect(estimateCostUSD('gpt-5-nano', usage)).toBeCloseTo(0.05 + 0.4, 5);
    expect(estimateCostUSD('gpt-5', usage)).toBeCloseTo(1.25 + 10.0, 5);
  });

  it('cache read da OpenAI é 0,1× o input', () => {
    const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    expect(estimateCostUSD('gpt-5', u)).toBeCloseTo(0.125, 5);
  });

  it('modelo desconhecido devolve null, não 0', () => {
    expect(estimateCostUSD('modelo-misterioso', usage)).toBeNull();
  });

  it('tabela Anthropic continua igual', () => {
    expect(estimateCostUSD('claude-haiku-4-5', usage)).toBeCloseTo(1 + 5, 5);
  });
});
