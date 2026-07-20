import { duracaoMs, SAMPLE_RATE } from './pcm.js';

export const GAP_MS = 200; // silêncio inserido entre segmentos na consolidação
const OVERLAP_MS = 300; // sobreposição ao cortar segmento gigante (proposta §5.2)
const WAV_HEADER_BYTES = 44;

export function consolidarSegmentos(
  segs: Int16Array[],
  gapMs = GAP_MS,
  sampleRate = SAMPLE_RATE,
): { pcm: Int16Array; speechMs: number } {
  if (segs.length === 0) return { pcm: new Int16Array(0), speechMs: 0 };
  const gap = Math.round((gapMs / 1000) * sampleRate);
  const falaAmostras = segs.reduce((s, seg) => s + seg.length, 0);
  const pcm = new Int16Array(falaAmostras + gap * (segs.length - 1));
  let pos = 0;
  segs.forEach((seg, i) => {
    if (i > 0) pos += gap; // Int16Array já nasce zerado = silêncio
    pcm.set(seg, pos);
    pos += seg.length;
  });
  return { pcm, speechMs: duracaoMs(falaAmostras, sampleRate) };
}

function bytesDoGrupo(amostras: number, nSegs: number, gap: number): number {
  return WAV_HEADER_BYTES + 2 * (amostras + gap * Math.max(0, nSegs - 1));
}

export function particionarPorBytes(
  segs: Int16Array[],
  maxBytes: number,
  gapMs = GAP_MS,
  sampleRate = SAMPLE_RATE,
): Int16Array[][] {
  const gap = Math.round((gapMs / 1000) * sampleRate);
  const maxAmostrasSozinho = Math.floor((maxBytes - WAV_HEADER_BYTES) / 2);
  const overlap = Math.round((OVERLAP_MS / 1000) * sampleRate);

  // 1. Corta segmentos individualmente maiores que o limite (caso raro: fala contínua enorme).
  const normalizados: Int16Array[] = [];
  for (const seg of segs) {
    if (seg.length <= maxAmostrasSozinho) {
      normalizados.push(seg);
      continue;
    }
    let inicio = 0;
    while (inicio < seg.length) {
      const fim = Math.min(seg.length, inicio + maxAmostrasSozinho);
      normalizados.push(seg.slice(inicio, fim));
      if (fim === seg.length) break;
      inicio = fim - overlap;
    }
  }

  // 2. Agrupamento greedy respeitando o tamanho do WAV consolidado do grupo.
  const grupos: Int16Array[][] = [];
  let atual: Int16Array[] = [];
  let amostras = 0;
  for (const seg of normalizados) {
    if (atual.length > 0 && bytesDoGrupo(amostras + seg.length, atual.length + 1, gap) > maxBytes) {
      grupos.push(atual);
      atual = [];
      amostras = 0;
    }
    atual.push(seg);
    amostras += seg.length;
  }
  if (atual.length > 0) grupos.push(atual);
  return grupos;
}
