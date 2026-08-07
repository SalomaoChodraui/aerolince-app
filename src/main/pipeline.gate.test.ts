import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../core/config/schema.js';
import { exigirChaves } from './pipeline.js';

function cfg(llm: Record<string, unknown>) {
  return ConfigSchema.parse({ masksDir: '/x', profilesDir: '/x', outputDir: '/x', stt: {}, llm });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('exigirChaves', () => {
  it('modo anthropic sem chave Anthropic falha com mensagem acionável', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-x');
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    expect(() => exigirChaves(cfg({}))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('modo openai só exige a chave OpenAI', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-x');
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    expect(() => exigirChaves(cfg({ provider: 'openai' }))).not.toThrow();
  });

  it('sem chave OpenAI falha em qualquer modo', () => {
    vi.stubEnv('OPENAI_API_KEY', undefined);
    expect(() => exigirChaves(cfg({ provider: 'openai' }))).toThrow(/OPENAI_API_KEY/);
  });
});
