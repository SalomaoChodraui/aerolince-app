import { afterEach, describe, expect, it } from 'vitest';
import { ConfigSchema } from '../core/config/schema.js';
import { exigirChaves } from './pipeline.js';

function cfg(llm: Record<string, unknown>) {
  return ConfigSchema.parse({ masksDir: '/x', profilesDir: '/x', outputDir: '/x', stt: {}, llm });
}

const backup = { ...process.env };
afterEach(() => {
  process.env['OPENAI_API_KEY'] = backup['OPENAI_API_KEY'];
  process.env['ANTHROPIC_API_KEY'] = backup['ANTHROPIC_API_KEY'];
});

describe('exigirChaves', () => {
  it('modo anthropic sem chave Anthropic falha com mensagem acionável', () => {
    process.env['OPENAI_API_KEY'] = 'sk-x';
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => exigirChaves(cfg({}))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('modo openai só exige a chave OpenAI', () => {
    process.env['OPENAI_API_KEY'] = 'sk-x';
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => exigirChaves(cfg({ provider: 'openai' }))).not.toThrow();
  });

  it('sem chave OpenAI falha em qualquer modo', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(() => exigirChaves(cfg({ provider: 'openai' }))).toThrow(/OPENAI_API_KEY/);
  });
});
