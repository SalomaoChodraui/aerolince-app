import { Mask } from './schema.js';

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const base = (id: string) => id.replace(/-com-contraste$/, '');

function citaContraste(transcript: string): boolean {
  const t = normalizar(transcript);
  return /\bcom contraste\b/.test(t) || /\bcontrastad/.test(t) || /\brealce\b/.test(t) || /\bfase (arterial|venosa|portal|tardia)\b/.test(t);
}

/**
 * Convenção do médico: sem citar contraste no comando → variante SEM contraste.
 * Aplica-se a QUALQUER máscara escolhida (local ou pelo LLM), tornando a escolha
 * da variante determinística em vez de depender do modelo.
 */
export function resolverContraste(mask: Mask, transcript: string, masks: Mask[]): Mask {
  const familia = base(mask.id);
  const variantes = masks.filter((m) => base(m.id) === familia);
  if (variantes.length < 2) return mask;
  const querContraste = citaContraste(transcript);
  return variantes.find((m) => (m.contraste === 'com') === querContraste) ?? mask;
}

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
  return resolverContraste(masks.find((m) => base(m.id) === [...familias][0])!, transcript, masks);
}

/**
 * Ranking LOCAL de máscaras por sobreposição de tokens com o comando —
 * alimenta o gate de confiança (candidatos quando a seleção do LLM é "media").
 * Determinístico, custo zero. Uma máscara por família; variante de contraste
 * resolvida pela convenção do médico.
 */
export function rankMasks(transcript: string, masks: Mask[], topN = 3): Mask[] {
  const t = normalizar(transcript);
  const palavras = new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const porFamilia = new Map<string, { mask: Mask; score: number }>();
  for (const m of masks) {
    let score = 0;
    for (const s of [m.nome, ...m.sinonimos]) {
      const sn = normalizar(s);
      if (new RegExp(`\\b${escapeRe(sn)}\\b`).test(t)) score += 10;
      for (const w of sn.split(/[^a-z0-9]+/)) {
        if (w.length >= 3 && palavras.has(w)) score += 1;
      }
    }
    const fam = base(m.id);
    const atual = porFamilia.get(fam);
    if (!atual || score > atual.score) porFamilia.set(fam, { mask: m, score });
  }
  return [...porFamilia.values()]
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => resolverContraste(x.mask, transcript, masks));
}
