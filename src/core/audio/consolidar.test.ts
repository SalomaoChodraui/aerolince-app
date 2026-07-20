import { describe, expect, it } from 'vitest';
import { consolidarSegmentos, GAP_MS, particionarPorBytes } from './consolidar.js';

const seg = (n: number, valor = 100) => new Int16Array(n).fill(valor);

describe('consolidarSegmentos', () => {
  it('vazio → pcm vazio e 0 ms de fala', () => {
    const r = consolidarSegmentos([]);
    expect(r.pcm.length).toBe(0);
    expect(r.speechMs).toBe(0);
  });

  it('um segmento → sem gap, speechMs correto', () => {
    const r = consolidarSegmentos([seg(16_000)]);
    expect(r.pcm.length).toBe(16_000);
    expect(r.speechMs).toBe(1000);
  });

  it('dois segmentos → um gap de silêncio entre eles', () => {
    const gapAmostras = (GAP_MS / 1000) * 16_000;
    const r = consolidarSegmentos([seg(1600, 5), seg(1600, 7)]);
    expect(r.pcm.length).toBe(1600 + gapAmostras + 1600);
    expect(r.pcm[0]).toBe(5);
    expect(r.pcm[1600]).toBe(0); // início do gap
    expect(r.pcm[1600 + gapAmostras]).toBe(7);
    expect(r.speechMs).toBe(200); // só fala conta; gap não
  });
});

describe('particionarPorBytes', () => {
  it('tudo cabe → um grupo único', () => {
    expect(particionarPorBytes([seg(100), seg(100)], 24 * 1024 * 1024)).toHaveLength(1);
  });

  it('divide em grupos nos limites de segmento', () => {
    // Cada segmento: 16000 amostras = 32 kB; cada gap de 200 ms = 6,4 kB. 2 segs + 1 gap =
    // 70.444 B (c/ header) cabem em 72 kB; 3 segs + 2 gaps = 108.844 B forçam 2º grupo.
    const grupos = particionarPorBytes([seg(16_000), seg(16_000), seg(16_000)], 72_000);
    expect(grupos).toHaveLength(2);
    expect(grupos[0]).toHaveLength(2);
    expect(grupos[1]).toHaveLength(1);
  });

  it('segmento único maior que o limite é cortado com overlap de 300 ms', () => {
    // 64000 amostras = 128 kB > 70 kB → 2 pedaços com overlap.
    const grupos = particionarPorBytes([seg(64_000)], 70_000);
    expect(grupos.length).toBeGreaterThan(1);
    const total = grupos.flat().reduce((s, p) => s + p.length, 0);
    expect(total).toBeGreaterThan(64_000); // overlap duplica ~300 ms por corte
  });
});
