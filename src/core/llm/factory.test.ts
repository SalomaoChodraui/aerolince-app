import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config/schema.js';
import { LLMClient } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { chavesNecessarias, criarLLM, MODELOS_PADRAO } from './factory.js';

function cfg(llm: Record<string, unknown>) {
  return ConfigSchema.parse({
    masksDir: '/x',
    profilesDir: '/x',
    outputDir: '/x',
    bibliotecaBaseDir: '/x',
    stt: {},
    llm,
  });
}

describe('criarLLM', () => {
  // O construtor do SDK da OpenAI exige apiKey (options ou OPENAI_API_KEY) mesmo
  // sem fazer nenhuma chamada de rede; sem isso, `new OpenAIProvider()` lança na
  // hora. Em produção o app já injeta a chave no ambiente antes de chamar
  // criarLLM — aqui simulamos isso com uma chave falsa só para a construção.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('default é Anthropic com os modelos configurados', () => {
    const r = criarLLM(cfg({}));
    expect(r.llm).toBeInstanceOf(LLMClient);
    expect(r.modelos).toEqual({ selecao: 'claude-haiku-4-5', geracao: 'claude-haiku-4-5', rapido: 'claude-haiku-4-5' });
  });

  it('provider openai com modelos claude-* cai nos defaults gpt', () => {
    vi.stubEnv('OPENAI_API_KEY', 'chave-falsa-de-teste');
    const r = criarLLM(cfg({ provider: 'openai' }));
    expect(r.llm).toBeInstanceOf(OpenAIProvider);
    expect(r.modelos).toEqual(MODELOS_PADRAO.openai);
  });

  it('provider openai respeita modelo gpt explícito', () => {
    vi.stubEnv('OPENAI_API_KEY', 'chave-falsa-de-teste');
    const r = criarLLM(cfg({ provider: 'openai', generationModel: 'gpt-5' }));
    expect(r.modelos.geracao).toBe('gpt-5');
    expect(r.modelos.selecao).toBe(MODELOS_PADRAO.openai.selecao);
  });

  it('provider anthropic com modelo gpt-* volta ao default claude', () => {
    const r = criarLLM(cfg({ provider: 'anthropic', generationModel: 'gpt-5-mini' }));
    expect(r.modelos.geracao).toBe('claude-haiku-4-5');
  });
});

describe('chavesNecessarias', () => {
  it('anthropic exige as duas chaves; openai só a da OpenAI', () => {
    expect(chavesNecessarias(cfg({}))).toEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
    expect(chavesNecessarias(cfg({ provider: 'openai' }))).toEqual(['OPENAI_API_KEY']);
  });
});
