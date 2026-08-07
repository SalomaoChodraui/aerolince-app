/**
 * Resolve provider + modelos a partir da config (BYOK). Modelo incompatível
 * com o provider escolhido cai no default do provider — troca de motor na
 * Settings nunca deixa um claude-* indo parar na OpenAI (ou vice-versa).
 */
import type { Config } from '../config/schema.js';
import { LLMClient } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider } from './types.js';

export const MODELOS_PADRAO = {
  anthropic: { selecao: 'claude-haiku-4-5', geracao: 'claude-haiku-4-5', rapido: 'claude-haiku-4-5' },
  openai: { selecao: 'gpt-5-mini', geracao: 'gpt-5-mini', rapido: 'gpt-5-mini' },
} as const;

export type NomeChaveNecessaria = 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY';

export interface LLMResolvido {
  llm: LLMProvider;
  modelos: { selecao: string; geracao: string; rapido: string };
}

function ajustar(provider: 'anthropic' | 'openai', modelo: string, papel: keyof typeof MODELOS_PADRAO.anthropic): string {
  const incompativel =
    provider === 'openai' ? modelo.startsWith('claude-') || modelo.startsWith('kimi-') : modelo.startsWith('gpt-');
  return incompativel ? MODELOS_PADRAO[provider][papel] : modelo;
}

export function criarLLM(config: Config): LLMResolvido {
  const p = config.llm.provider;
  return {
    llm: p === 'openai' ? new OpenAIProvider() : new LLMClient(),
    modelos: {
      selecao: ajustar(p, config.llm.selectionModel, 'selecao'),
      geracao: ajustar(p, config.llm.generationModel, 'geracao'),
      rapido: ajustar(p, config.llm.fastModel, 'rapido'),
    },
  };
}

/** OpenAI é sempre necessária (STT); Anthropic só quando é o motor de geração. */
export function chavesNecessarias(config: Config): NomeChaveNecessaria[] {
  return config.llm.provider === 'anthropic' ? ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] : ['OPENAI_API_KEY'];
}
