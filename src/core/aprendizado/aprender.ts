/**
 * Extrai as REGRAS DO MÉDICO (limites de protocolo, frasário patológico,
 * estrutura) de um corpus de laudos sanitizados de uma máscara. Lógica movida
 * de `src/cli/index.ts` (T4) — `APRENDER_SYSTEM` permanece intacto em
 * `core/engine/prompts.ts`.
 *
 * MUDANÇA DE COMPORTAMENTO (T4): grava sempre em `<masksDir>/_rascunhos/regras-<id>.md`,
 * NUNCA mais direto em `<masksDir>/regras/<id>.md` — a curadoria manual do médico
 * (ex.: "Ordem canônica" adicionada à mão) fica protegida; promoção explícita
 * via `aplicarRascunho` (com backup).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync } from '../atomic-write.js';
import { APRENDER_SYSTEM } from '../engine/prompts.js';
import { estimateCostUSD } from '../llm/anthropic.js';
import { montarCorpus } from './corpus.js';
import type { OpcoesAprendizado, ResultadoAprendizado } from './tipos.js';

export type { OpcoesAprendizado, ResultadoAprendizado } from './tipos.js';

export async function aprenderRegras(
  params: { maskId: string; arquivos: string[]; masksDir: string },
  o: OpcoesAprendizado,
): Promise<ResultadoAprendizado> {
  const { maskId, arquivos, masksDir } = params;

  o.onProgresso?.({ etapa: 'montando corpus', atual: 1, total: 3 });
  const { corpus, total } = montarCorpus(arquivos);

  if (o.cancelado?.()) throw new Error('aprendizado cancelado antes da chamada ao LLM');
  o.onProgresso?.({ etapa: 'aprendendo com o LLM', atual: 2, total: 3 });
  const r = await o.llm.complete({
    model: o.modelo,
    system: [{ text: APRENDER_SYSTEM, cache: true }],
    user: `Tipo de exame: ${maskId}\n\n${corpus}`,
    maxTokens: 4000,
  });
  const custoUSD = estimateCostUSD(o.modelo, r.usage);

  o.onProgresso?.({ etapa: 'gravando rascunho', atual: 3, total: 3 });
  const dir = join(masksDir, '_rascunhos');
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, `regras-${maskId}.md`);
  writeFileAtomicSync(
    arquivo,
    `<!-- RASCUNHO gerado automaticamente de ${total} laudos — REVISE antes de aplicar (\`laudo aplicar regras-${maskId}.md\`); só passa a valer na geração depois de aplicado -->\n\n${r.text.trim()}\n`,
  );

  return { arquivo, custoUSD };
}
