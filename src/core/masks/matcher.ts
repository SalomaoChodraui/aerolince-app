import { Mask } from './schema.js';

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const base = (id: string) => id.replace(/-com-contraste$/, '');

/**
 * Seleção LOCAL de máscara (sem LLM, custo zero, 0 ms): casa nome/sinônimos por
 * palavra inteira. Só decide quando exatamente UMA família de exame bate;
 * variantes com/sem contraste são resolvidas pela convenção do médico
 * (sem citar contraste → sem contraste). Ambiguidade → null (cai para o LLM).
 */
export function matchLocal(transcript: string, masks: Mask[]): Mask | null {
  const t = normalizar(transcript);
  const hits = masks.filter((m) =>
    [m.nome, ...m.sinonimos].some((s) => new RegExp(`\\b${escapeRe(normalizar(s))}\\b`).test(t)),
  );
  if (hits.length === 0) return null;
  const familias = new Set(hits.map((h) => base(h.id)));
  if (familias.size !== 1) return null;
  const familia = [...familias][0]!;
  const variantes = masks.filter((m) => base(m.id) === familia);
  if (variantes.length === 1) return variantes[0]!;
  const comContraste = /\bcom contraste\b/.test(t) || /\bcontrastad/.test(t);
  return variantes.find((m) => (m.contraste === 'com') === comContraste) ?? null;
}
