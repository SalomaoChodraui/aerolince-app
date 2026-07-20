import { describe, expect, it } from 'vitest';
import { duracaoMs, fatiarPcm, float32ParaInt16, SAMPLE_RATE } from './pcm.js';

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

describe('fatiarPcm', () => {
  it('menor que o cap → 1 pedaço, o próprio array intacto', () => {
    const pcm = new Int16Array([1, 2, 3, 4, 5]);
    const partes = fatiarPcm(pcm, 10);
    expect(partes).toHaveLength(1);
    expect(partes[0]).toBe(pcm); // caso comum: sem cópia
  });

  it('exatamente 2× o cap → 2 pedaços de tamanho igual', () => {
    const pcm = Int16Array.from({ length: 20 }, (_, i) => i);
    const partes = fatiarPcm(pcm, 10);
    expect(partes.map((p) => p.length)).toEqual([10, 10]);
  });

  it('resto pequeno → último pedaço menor', () => {
    const pcm = Int16Array.from({ length: 23 }, (_, i) => i);
    const partes = fatiarPcm(pcm, 10);
    expect(partes.map((p) => p.length)).toEqual([10, 10, 3]);
  });

  it('roundtrip: concatenar os pedaços reproduz o conteúdo original', () => {
    const pcm = Int16Array.from({ length: 25 }, (_, i) => i * 3 - 100);
    const partes = fatiarPcm(pcm, 7);
    const juntado = Int16Array.from(partes.flatMap((p) => Array.from(p)));
    expect(Array.from(juntado)).toEqual(Array.from(pcm));
    // cada pedaço tem buffer próprio do tamanho exato (seguro para IPC)
    for (const p of partes) expect(p.buffer.byteLength).toBe(p.length * 2);
  });
});
