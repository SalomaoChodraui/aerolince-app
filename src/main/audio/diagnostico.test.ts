import { describe, expect, it } from 'vitest';
import { validarDiagnostico } from './diagnostico.js';

const VALIDO = {
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
};

describe('validarDiagnostico', () => {
  it('aceita um payload completo e válido', () => {
    expect(validarDiagnostico(VALIDO)).toEqual(VALIDO);
  });

  it('aceita sampleRateNativo e microfone null (ambiente sem essas capacidades)', () => {
    const d = { ...VALIDO, sampleRateNativo: null, microfone: null };
    expect(validarDiagnostico(d)).toEqual(d);
  });

  it('rejeita não-objeto', () => {
    expect(validarDiagnostico(null)).toBeNull();
    expect(validarDiagnostico(undefined)).toBeNull();
    expect(validarDiagnostico('x')).toBeNull();
    expect(validarDiagnostico(42)).toBeNull();
  });

  it('rejeita quando falta um campo numérico', () => {
    const { segmentosVadEmitidos: _omit, ...semCampo } = VALIDO;
    expect(validarDiagnostico(semCampo)).toBeNull();
  });

  it('rejeita campo numérico com tipo errado', () => {
    expect(validarDiagnostico({ ...VALIDO, misfires: '2' })).toBeNull();
  });

  it('rejeita campo numérico não finito (NaN/Infinity)', () => {
    expect(validarDiagnostico({ ...VALIDO, segmentosAceitos: NaN })).toBeNull();
    expect(validarDiagnostico({ ...VALIDO, segmentosAceitos: Infinity })).toBeNull();
  });

  it('rejeita sensibilidade vazia ou de tipo errado', () => {
    expect(validarDiagnostico({ ...VALIDO, sensibilidade: '' })).toBeNull();
    expect(validarDiagnostico({ ...VALIDO, sensibilidade: 1 })).toBeNull();
  });

  it('rejeita audioWorkletDisponivel que não seja boolean', () => {
    expect(validarDiagnostico({ ...VALIDO, audioWorkletDisponivel: 'sim' })).toBeNull();
  });

  it('rejeita sampleRateNativo que não seja number nem null', () => {
    expect(validarDiagnostico({ ...VALIDO, sampleRateNativo: '48000' })).toBeNull();
  });

  it('rejeita microfone que não seja string nem null', () => {
    expect(validarDiagnostico({ ...VALIDO, microfone: 123 })).toBeNull();
  });
});
