import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './openai.js';

function fakeClient(resposta: unknown) {
  const create = vi.fn().mockResolvedValue(resposta);
  return { client: { chat: { completions: { create } } } as never, create };
}

const RESPOSTA = {
  choices: [{ message: { content: 'laudo aqui' } }],
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 300,
    prompt_tokens_details: { cached_tokens: 1000 },
  },
};

describe('OpenAIProvider', () => {
  it('concatena os SystemBlocks numa única mensagem system e mapeia o usage', async () => {
    const { client, create } = fakeClient(RESPOSTA);
    const p = new OpenAIProvider({ client });
    const r = await p.complete({
      model: 'gpt-5-mini',
      system: [{ text: 'A', cache: true }, { text: 'B' }],
      user: 'comando',
      maxTokens: 500,
    });
    expect(create).toHaveBeenCalledWith({
      model: 'gpt-5-mini',
      max_completion_tokens: 500,
      messages: [
        { role: 'system', content: 'A\n\nB' },
        { role: 'user', content: 'comando' },
      ],
      reasoning_effort: 'minimal',
    });
    expect(r.text).toBe('laudo aqui');
    // prompt_tokens da OpenAI INCLUI os cacheados — inputTokens é o restante
    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 300, cacheReadTokens: 1000, cacheWriteTokens: 0 });
  });

  it('resposta sem usage ou sem texto não explode', async () => {
    const { client } = fakeClient({ choices: [{ message: { content: null } }] });
    const p = new OpenAIProvider({ client });
    const r = await p.complete({ model: 'gpt-5', system: [], user: 'x', maxTokens: 10 });
    expect(r.text).toBe('');
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});
