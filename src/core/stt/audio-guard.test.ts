import { describe, expect, it } from 'vitest';
import { MAX_AUDIO_BYTES, validarAudio } from './audio-guard.js';

describe('validarAudio', () => {
  it('aceita tamanho normal', () => {
    expect(() => validarAudio(500_000)).not.toThrow();
  });
  it('rejeita áudio vazio/minúsculo', () => {
    expect(() => validarAudio(100)).toThrow(/microfone/);
  });
  it('rejeita gravação acima do limite da API', () => {
    expect(() => validarAudio(MAX_AUDIO_BYTES + 1)).toThrow(/longa/);
  });
});
