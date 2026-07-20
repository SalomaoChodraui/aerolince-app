// Conversões PCM puras. ATENÇÃO: este módulo é importado pelo RENDERER —
// não pode usar Buffer nem APIs node:*.

export const SAMPLE_RATE = 16_000;

export function float32ParaInt16(entrada: Float32Array): Int16Array {
  const saida = new Int16Array(entrada.length);
  for (let i = 0; i < entrada.length; i++) {
    const valor = entrada[i]!;
    const s = Math.max(-1, Math.min(1, valor));
    saida[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return saida;
}

export function duracaoMs(amostras: number, sampleRate: number = SAMPLE_RATE): number {
  return Math.round((amostras / sampleRate) * 1000);
}

/**
 * Fatia PCM em pedaços contíguos de no máximo `maxAmostras` (sem overlap). Cada pedaço
 * é um Int16Array independente com `.buffer` do tamanho exato, seguro para transferir via
 * IPC. Fala curta (≤ cap) devolve o próprio array intacto — sem cópia no caso comum.
 * Usado para não estourar o cap de tamanho de segmento do IPC/main numa fala muito longa.
 */
export function fatiarPcm(pcm: Int16Array, maxAmostras: number): Int16Array[] {
  if (pcm.length <= maxAmostras) return [pcm];
  const partes: Int16Array[] = [];
  for (let i = 0; i < pcm.length; i += maxAmostras) {
    partes.push(pcm.slice(i, i + maxAmostras)); // slice → novo buffer do tamanho exato
  }
  return partes;
}
