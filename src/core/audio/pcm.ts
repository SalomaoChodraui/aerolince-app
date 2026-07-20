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
