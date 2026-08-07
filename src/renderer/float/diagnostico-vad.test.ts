import { describe, expect, it } from 'vitest';
import { montarDiagnostico } from './diagnostico-vad.js';

// Função pura — sem DOM (AudioContext/enumerateDevices ficam de fora, coletados
// à parte no main.tsx). Cobre só a montagem do payload de diagnóstico.
describe('montarDiagnostico', () => {
  const contadores = { segmentosVadEmitidos: 5, segmentosAceitos: 4, segmentosRecusados: 1, misfires: 2 };
  const capacidades = { sampleRateNativo: 48000, audioWorkletDisponivel: true, microfone: 'MacBook Pro Microphone' };

  it('junta contadores + thresholds efetivos da sensibilidade + capacidades', () => {
    expect(montarDiagnostico(contadores, 'media', capacidades)).toEqual({
      segmentosVadEmitidos: 5,
      segmentosAceitos: 4,
      segmentosRecusados: 1,
      misfires: 2,
      sensibilidade: 'media',
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      minSpeechMs: 400,
      preSpeechPadMs: 800,
      sampleRateNativo: 48000,
      audioWorkletDisponivel: true,
      microfone: 'MacBook Pro Microphone',
    });
  });

  it('usa os thresholds de "alta" quando a sensibilidade é alta', () => {
    const d = montarDiagnostico(contadores, 'alta', capacidades);
    expect(d.positiveSpeechThreshold).toBe(0.2);
    expect(d.negativeSpeechThreshold).toBe(0.15);
    expect(d.minSpeechMs).toBe(150);
    expect(d.preSpeechPadMs).toBe(1000);
  });

  it('usa os thresholds de "baixa" quando a sensibilidade é baixa', () => {
    const d = montarDiagnostico(contadores, 'baixa', capacidades);
    expect(d.positiveSpeechThreshold).toBe(0.5);
    expect(d.negativeSpeechThreshold).toBe(0.35);
  });

  it('capacidades ausentes (null) passam intactas — sem inventar valor', () => {
    const d = montarDiagnostico(contadores, 'media', {
      sampleRateNativo: null,
      audioWorkletDisponivel: false,
      microfone: null,
    });
    expect(d.sampleRateNativo).toBeNull();
    expect(d.microfone).toBeNull();
    expect(d.audioWorkletDisponivel).toBe(false);
  });
});
