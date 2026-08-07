/**
 * Provedor OpenAI (modo provedor único do BYOK): mapeia o contrato LLMProvider
 * para chat.completions. Os SystemBlocks viram UMA mensagem system (a OpenAI
 * não tem blocos nem cache_control — o caching lá é automático, e aparece em
 * usage.prompt_tokens_details.cached_tokens). prompt_tokens INCLUI os tokens
 * cacheados; inputTokens aqui é o restante, para o estimateCostUSD não cobrar
 * duas vezes.
 */
import OpenAI from 'openai';
import type { CompleteParams, LLMProvider, LLMResult } from './types.js';

type ChatClient = Pick<OpenAI, 'chat'>;

export interface OpenAIProviderOptions {
  apiKey?: string;
  /** Injeção para testes — objeto compatível com o cliente oficial. */
  client?: ChatClient;
}

export class OpenAIProvider implements LLMProvider {
  private client: ChatClient;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.client = opts.client ?? new OpenAI(opts.apiKey ? { apiKey: opts.apiKey } : undefined);
  }

  async complete(params: CompleteParams): Promise<LLMResult> {
    const system = params.system.map((b) => b.text).join('\n\n');
    const r = await this.client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: params.user },
      ],
    });
    const texto = r.choices[0]?.message?.content ?? '';
    const u = r.usage;
    const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: texto,
      usage: {
        inputTokens: Math.max(0, (u?.prompt_tokens ?? 0) - cached),
        outputTokens: u?.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }
}
