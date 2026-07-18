import { z } from 'zod';
import { LLMClient, LLMUsage, SystemBlock } from '../llm/anthropic.js';
import { Mask } from '../masks/schema.js';
import { buildCatalog, getMask } from '../masks/library.js';
import { resolverContraste } from '../masks/matcher.js';
import { DiffResult, parseOrganBlocks, stripMarkers } from './diff.js';
import { PatchError, applyPatches, parsePatches, patchedIds } from './patch.js';
import {
  GENERATION_RULES,
  generationContext,
  generationProfileBlock,
  generationUser,
  refineUser,
  selectionSystem,
  selectionUser,
} from './prompts.js';

const SelectionSchema = z.object({
  mask_id: z.string(),
  confianca: z.enum(['alta', 'media', 'baixa']),
});

export interface SelectionResult {
  mask: Mask | null;
  confianca: 'alta' | 'media' | 'baixa';
  durationMs: number;
  usage: LLMUsage;
}

export interface GenerationResult {
  /** Laudo final, sem marcadores — pronto para clipboard. */
  report: string;
  /** Laudo com marcadores (para diff e refino posteriores). */
  reportRaw: string;
  diff: DiffResult;
  durationMs: number;
  usage: LLMUsage;
}

const ZERO_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // O modelo às vezes acrescenta texto ao redor do JSON — extrai o primeiro objeto plano
    const m = cleaned.match(/\{[^{}]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`resposta de seleção não é JSON válido: ${cleaned.slice(0, 120)}`);
  }
}

export async function selectMask(
  llm: LLMClient,
  model: string,
  transcript: string,
  masks: Mask[],
): Promise<SelectionResult> {
  const t0 = performance.now();
  const result = await llm.complete({
    model,
    system: [{ text: selectionSystem(buildCatalog(masks)), cache: true }],
    user: selectionUser(transcript),
    maxTokens: 200,
  });
  const parsed = SelectionSchema.parse(parseJson(result.text));
  const escolhida = parsed.mask_id === 'nenhuma' ? null : (getMask(masks, parsed.mask_id) ?? null);
  // Convenção do contraste é determinística — não fica a critério do modelo
  const mask = escolhida ? resolverContraste(escolhida, transcript, masks) : null;
  return {
    mask,
    confianca: parsed.confianca,
    durationMs: performance.now() - t0,
    usage: result.usage,
  };
}

interface PatchRun {
  reportRaw: string;
  changed: string[];
  usage: LLMUsage;
}

/**
 * Pede patches ao modelo e aplica sobre `baseBody` localmente.
 * Uma nova tentativa em caso de formato inválido; depois, erro.
 */
async function runPatches(
  llm: LLMClient,
  model: string,
  system: SystemBlock[],
  user: string,
  baseBody: string,
): Promise<PatchRun> {
  let usage = ZERO_USAGE;
  let lastErr = '';
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const prompt =
      tentativa === 1
        ? user
        : `${user}\n\nATENÇÃO: sua resposta anterior era inválida (${lastErr}). Responda SOMENTE com patches no formato "@@ …" especificado nas regras.`;
    const result = await llm.complete({ model, system, user: prompt, maxTokens: 1500 });
    usage = addUsage(usage, result.usage);
    try {
      const ops = parsePatches(result.text);
      return { reportRaw: applyPatches(baseBody, ops), changed: patchedIds(ops), usage };
    } catch (err) {
      if (!(err instanceof PatchError)) throw err;
      lastErr = err.message;
    }
  }
  throw new Error(`geração falhou no formato de patches: ${lastErr}`);
}

function buildResult(
  maskBody: string,
  run: PatchRun,
  t0: number,
): GenerationResult {
  const organIds = parseOrganBlocks(maskBody).map((b) => b.id);
  return {
    report: stripMarkers(run.reportRaw),
    reportRaw: run.reportRaw,
    diff: {
      changed: run.changed,
      kept: organIds.filter((id) => !run.changed.includes(id)),
    },
    durationMs: performance.now() - t0,
    usage: run.usage,
  };
}

export interface GenerateParams {
  mask: Mask;
  transcript: string;
  profileName: string;
  profileBody: string;
  model: string;
  /** REGRAS DO MÉDICO destiladas dos laudos dele (comando `aprender`). */
  regras?: string;
}

export async function generate(llm: LLMClient, p: GenerateParams): Promise<GenerationResult> {
  const t0 = performance.now();
  const system: SystemBlock[] = [
    { text: GENERATION_RULES, cache: true },
    { text: generationContext(p.mask.body, p.regras), cache: true },
    { text: generationProfileBlock(p.profileName, p.profileBody) },
  ];
  const run = await runPatches(llm, p.model, system, generationUser(p.transcript), p.mask.body);
  return buildResult(p.mask.body, run, t0);
}

export interface RefineParams {
  mask: Mask;
  currentReportRaw: string;
  command: string;
  profileName: string;
  profileBody: string;
  model: string;
  regras?: string;
}

export async function refine(llm: LLMClient, p: RefineParams): Promise<GenerationResult> {
  const t0 = performance.now();
  const system: SystemBlock[] = [
    { text: GENERATION_RULES, cache: true },
    { text: generationContext(p.mask.body, p.regras), cache: true },
    { text: generationProfileBlock(p.profileName, p.profileBody) },
  ];
  const run = await runPatches(
    llm,
    p.model,
    system,
    refineUser(p.currentReportRaw, p.command),
    p.currentReportRaw,
  );
  return buildResult(p.mask.body, run, t0);
}
