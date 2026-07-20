import { describe, expect, it } from 'vitest';
import { duracaoMs, float32ParaInt16, SAMPLE_RATE } from './pcm.js';

describe('float32ParaInt16', () => {
  it('converte os extremos e o zero', () => {
    const out = float32ParaInt16(new Float32Array([0, 1, -1]));
    expect(Array.from(out)).toEqual([0, 32767, -32768]);
  });

  it('clampa valores fora de [-1, 1]', () => {
    const out = float32ParaInt16(new Float32Array([1.5, -2]));
    expect(Array.from(out)).toEqual([32767, -32768]);
  });

  it('escala linearmente um valor intermediário', () => {
    const out = float32ParaInt16(new Float32Array([0.5]));
    expect(out[0]).toBe(Math.round(0.5 * 32767));
  });
});

describe('duracaoMs', () => {
  it('16000 amostras a 16 kHz = 1000 ms', () => {
    expect(duracaoMs(16_000)).toBe(1000);
  });

  it('sample rate padrão é 16 kHz', () => {
    expect(SAMPLE_RATE).toBe(16_000);
  });
});
