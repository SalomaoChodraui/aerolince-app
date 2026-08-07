import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../../core/config/schema.js';
import { PARAMETROS_POR_SENSIBILIDADE } from './vad-sensibilidade.js';

// Tabela pura — sem importar '@ricky0123/vad-web' (evita qualquer efeito colateral
// de import em ambiente de teste Node/sem DOM). `captura-vad.ts` é quem liga isso
// ao MicVAD de verdade.
describe('PARAMETROS_POR_SENSIBILIDADE', () => {
  it('alta: voz baixa/microfone distante — thresholds mais baixos, capta mais', () => {
    expect(PARAMETROS_POR_SENSIBILIDADE.alta).toEqual({
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.2,
      minSpeechMs: 200,
      preSpeechPadMs: 1000,
    });
  });

  it('media: padrão', () => {
    expect(PARAMETROS_POR_SENSIBILIDADE.media).toEqual({
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      minSpeechMs: 400,
      preSpeechPadMs: 800,
    });
  });

  it('baixa: ambiente ruidoso — thresholds mais altos, capta menos', () => {
    expect(PARAMETROS_POR_SENSIBILIDADE.baixa).toEqual({
      positiveSpeechThreshold: 0.65,
      negativeSpeechThreshold: 0.5,
      minSpeechMs: 500,
      preSpeechPadMs: 600,
    });
  });

  it('cada tabela respeita negativeSpeechThreshold < positiveSpeechThreshold (regra da lib)', () => {
    for (const params of Object.values(PARAMETROS_POR_SENSIBILIDADE)) {
      expect(params.negativeSpeechThreshold).toBeLessThan(params.positiveSpeechThreshold);
    }
  });
});

describe('schema — sensibilidadeVad', () => {
  it('default é "media"', () => {
    const config = ConfigSchema.parse({
      masksDir: '/x',
      profilesDir: '/x',
      outputDir: '/x',
      bibliotecaBaseDir: '/x',
      acervoDir: '/x',
      stt: {},
      llm: {},
    });
    expect(config.stt.sensibilidadeVad).toBe('media');
  });
});
