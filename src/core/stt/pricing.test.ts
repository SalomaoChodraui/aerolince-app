import { describe, expect, it } from 'vitest';
import { estimateSttCostUSD } from './pricing.js';

describe('estimateSttCostUSD', () => {
  it('prioriza usage por token quando presente', () => {
    // gpt-4o-transcribe: áudio in $6/1M tokens
    const custo = estimateSttCostUSD('gpt-4o-transcribe', {
      usage: { inputAudioTokens: 1_000_000, inputTextTokens: 0, outputTokens: 0 },
      audioMs: 60_000, // ignorado quando há usage
    });
    expect(custo).toBeCloseTo(6, 6);
  });

  it('soma os três eixos de tokens', () => {
    const custo = estimateSttCostUSD('gpt-4o-transcribe', {
      usage: { inputAudioTokens: 10_000, inputTextTokens: 4_000, outputTokens: 2_000 },
    });
    // 10k×$6/1M + 4k×$2.50/1M + 2k×$10/1M
    expect(custo).toBeCloseTo(0.06 + 0.01 + 0.02, 6);
  });

  it('sem usage cai para USD/min sobre audioMs', () => {
    expect(estimateSttCostUSD('gpt-4o-transcribe', { audioMs: 60_000 })).toBeCloseTo(0.006, 6);
    expect(estimateSttCostUSD('gpt-4o-mini-transcribe', { audioMs: 60_000 })).toBeCloseTo(0.003, 6);
  });

  it('modelo desconhecido → null (nunca inventar custo)', () => {
    expect(estimateSttCostUSD('whisper-do-futuro', { audioMs: 60_000 })).toBeNull();
  });

  it('sem usage e sem audioMs → null', () => {
    expect(estimateSttCostUSD('gpt-4o-transcribe', {})).toBeNull();
  });
});
