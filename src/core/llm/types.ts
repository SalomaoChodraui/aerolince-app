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

/** Contrato mínimo de um provedor de LLM (Anthropic, OpenAI, …). */
export interface LLMProvider {
  complete(params: CompleteParams): Promise<LLMResult>;
}
