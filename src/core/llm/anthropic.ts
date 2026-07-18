import Anthropic from '@anthropic-ai/sdk';

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LLMResult {
  text: string;
  usage: LLMUsage;
}

export interface SystemBlock {
  text: string;
  /** Marca este bloco como fronteira de prompt caching (conteúdo estável). */
  cache?: boolean;
}

export interface CompleteParams {
  model: string;
  system: SystemBlock[];
  user: string;
  maxTokens: number;
}

/**
 * Wrapper fino do Claude: aplica cache_control nos blocos estáveis e desliga o
 * thinking adaptativo em modelos Sonnet 5 (latência previsível para geração de laudo).
 */
export interface LLMClientOptions {
  apiKey?: string;
  /** Endpoint alternativo compatível com a API Anthropic (ex.: Moonshot/Kimi). */
  baseURL?: string;
  /** Desligar cache_control para provedores que não suportam prompt caching. */
  supportsCache?: boolean;
}

export class LLMClient {
  private client: Anthropic;
  private supportsCache: boolean;

  constructor(opts: LLMClientOptions | string = {}) {
    const o = typeof opts === 'string' ? { apiKey: opts } : opts;
    this.supportsCache = o.supportsCache ?? true;
    this.client = new Anthropic({
      ...(o.apiKey ? { apiKey: o.apiKey } : {}),
      ...(o.baseURL ? { baseURL: o.baseURL } : {}),
    });
  }

  async complete(params: CompleteParams): Promise<LLMResult> {
    const system = params.system.map((b) => ({
      type: 'text' as const,
      text: b.text,
      ...(b.cache && this.supportsCache ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system,
      messages: [{ role: 'user', content: params.user }],
      ...(params.model.includes('sonnet-5') ? { thinking: { type: 'disabled' as const } } : {}),
    } as Parameters<typeof this.client.messages.create>[0]);

    const r = response as Anthropic.Message;
    const text = r.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('');
    const u = r.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    return {
      text,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/** Estimativa de custo em USD (preços por MTok; atualizar se a tabela mudar). */
export function estimateCostUSD(model: string, usage: LLMUsage): number {
  const prices: Record<string, [number, number]> = {
    'claude-haiku-4-5': [1, 5],
    'claude-sonnet-5': [3, 15],
    // Moonshot/Kimi K2 — aproximado; conferir a tabela vigente em platform.moonshot.ai
    'kimi-': [0.6, 2.5],
  };
  const key = Object.keys(prices).find((k) => model.startsWith(k));
  if (!key) return 0;
  const [inP, outP] = prices[key]!;
  // Cache: escrita custa 1,25× o input; leitura custa 0,1×
  return (
    (usage.inputTokens * inP +
      usage.cacheWriteTokens * inP * 1.25 +
      usage.cacheReadTokens * inP * 0.1 +
      usage.outputTokens * outP) /
    1_000_000
  );
}
