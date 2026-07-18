import Anthropic from '@anthropic-ai/sdk';

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
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
export class LLMClient {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
  }

  async complete(params: CompleteParams): Promise<LLMResult> {
    const system = params.system.map((b) => ({
      type: 'text' as const,
      text: b.text,
      ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
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
    return {
      text,
      usage: {
        inputTokens: r.usage.input_tokens,
        outputTokens: r.usage.output_tokens,
        cacheReadTokens: (r.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
      },
    };
  }
}

/** Estimativa de custo em USD (preços por MTok; atualizar se a tabela mudar). */
export function estimateCostUSD(model: string, usage: LLMUsage): number {
  const prices: Record<string, [number, number]> = {
    'claude-haiku-4-5': [1, 5],
    'claude-sonnet-5': [3, 15],
  };
  const key = Object.keys(prices).find((k) => model.startsWith(k));
  if (!key) return 0;
  const [inP, outP] = prices[key]!;
  return (usage.inputTokens * inP + usage.outputTokens * outP) / 1_000_000;
}
