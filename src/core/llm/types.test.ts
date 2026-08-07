import { describe, expect, it } from 'vitest';
import { LLMClient } from './anthropic.js';
import type { CompleteParams, LLMProvider, LLMResult } from './types.js';

describe('LLMProvider', () => {
  it('LLMClient satisfaz a interface (atribuição estrutural)', () => {
    const p: LLMProvider = new LLMClient({ apiKey: 'sk-teste-nao-usada' });
    expect(typeof p.complete).toBe('function');
  });

  it('um provider fake mínimo satisfaz a interface', async () => {
    const fake: LLMProvider = {
      complete: async (params: CompleteParams): Promise<LLMResult> => ({
        text: `eco:${params.user}`,
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    };
    const r = await fake.complete({ model: 'x', system: [], user: 'oi', maxTokens: 10 });
    expect(r.text).toBe('eco:oi');
  });
});
