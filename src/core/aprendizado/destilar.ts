/**
 * Destila a MÁSCARA-CONSENSO de um tipo de exame a partir dos laudos sanitizados
 * do acervo. Lógica movida de `src/cli/index.ts` (T4) — o prompt `DESTILAR_SYSTEM`
 * permanece intacto em `core/engine/prompts.ts`.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync } from '../atomic-write.js';
import { DESTILAR_SYSTEM } from '../engine/prompts.js';
import { estimateCostUSD } from '../llm/anthropic.js';
import { montarCorpus } from './corpus.js';
import type { OpcoesAprendizado, ResultadoAprendizado } from './tipos.js';

export type { OpcoesAprendizado, ResultadoAprendizado } from './tipos.js';

/** Remove cercas de código markdown (```markdown / ``` md / ```) que o modelo às vezes emite. */
function stripCercas(texto: string): string {
  return texto
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * Uso: destila `id` a partir de `arquivos` (já resolvidos pelo chamador via
 * `corpusPorPrefixos`/`corpusPorArquivos`). Escreve o rascunho em
 * `<masksDir>/_rascunhos/<id>.md` — NUNCA direto na biblioteca; o médico
 * revisa e promove com `aplicarRascunho`.
 */
export async function destilarMascara(
  params: { id: string; arquivos: string[]; masksDir: string },
  o: OpcoesAprendizado,
): Promise<ResultadoAprendizado> {
  const { id, arquivos, masksDir } = params;

  o.onProgresso?.({ etapa: 'montando corpus', atual: 1, total: 3 });
  const { corpus } = montarCorpus(arquivos);

  if (o.cancelado?.()) throw new Error('destilação cancelada antes da chamada ao LLM');
  o.onProgresso?.({ etapa: 'destilando com o LLM', atual: 2, total: 3 });
  const r = await o.llm.complete({
    model: o.modelo,
    system: [{ text: DESTILAR_SYSTEM, cache: true }],
    user: `id: ${id}\n\n${corpus}`,
    maxTokens: 2500,
  });
  const custoUSD = estimateCostUSD(o.modelo, r.usage);

  o.onProgresso?.({ etapa: 'gravando rascunho', atual: 3, total: 3 });
  const dir = join(masksDir, '_rascunhos');
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, `${id}.md`);
  writeFileAtomicSync(arquivo, `${stripCercas(r.text)}\n`);

  return { arquivo, custoUSD };
}
