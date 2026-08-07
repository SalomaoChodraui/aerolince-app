/**
 * Extrai os PARES DE SÍNTESE DA CONCLUSÃO (frase descritiva do corpo → expressão
 * diagnóstica curta na Conclusão) de um corpus de laudos sanitizados de uma
 * máscara — mesmo padrão de `aprender.ts`; o prompt `SINTESE_SYSTEM` vive em
 * `core/engine/prompts.ts`.
 *
 * Grava sempre em `<masksDir>/_rascunhos/sintese-<maskId>.md`, NUNCA direto em
 * `regras/` — a tabela manual curada pelo médico fica protegida; promoção
 * explícita via `aplicarRascunho` (com backup), destino `regras/sintese-<maskId>.md`.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync } from '../atomic-write.js';
import { SINTESE_SYSTEM } from '../engine/prompts.js';
import { estimateCostUSD } from '../llm/anthropic.js';
import { montarCorpus } from './corpus.js';
import type { OpcoesAprendizado, ResultadoAprendizado } from './tipos.js';

export type { OpcoesAprendizado, ResultadoAprendizado } from './tipos.js';

export async function destilarSintese(
  params: { maskId: string; arquivos: string[]; masksDir: string },
  o: OpcoesAprendizado,
): Promise<ResultadoAprendizado> {
  const { maskId, arquivos, masksDir } = params;

  o.onProgresso?.({ etapa: 'montando corpus', atual: 1, total: 3 });
  const { corpus, total } = montarCorpus(arquivos);

  if (o.cancelado?.()) throw new Error('síntese cancelada antes da chamada ao LLM');
  o.onProgresso?.({ etapa: 'aprendendo a síntese com o LLM', atual: 2, total: 3 });
  const r = await o.llm.complete({
    model: o.modelo,
    system: [{ text: SINTESE_SYSTEM, cache: true }],
    user: `Tipo de exame: ${maskId}\n\n${corpus}`,
    maxTokens: 3000,
  });
  const custoUSD = estimateCostUSD(o.modelo, r.usage);

  o.onProgresso?.({ etapa: 'gravando rascunho', atual: 3, total: 3 });
  const dir = join(masksDir, '_rascunhos');
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, `sintese-${maskId}.md`);
  writeFileAtomicSync(
    arquivo,
    `<!-- RASCUNHO gerado automaticamente de ${total} laudos — REVISE antes de aplicar (\`laudo aplicar sintese-${maskId}.md\`); só passa a valer na geração depois de aplicado -->\n\n${r.text.trim()}\n`,
  );

  return { arquivo, custoUSD };
}
