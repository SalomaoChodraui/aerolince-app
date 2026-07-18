import { z } from 'zod';
import { LLMClient, LLMUsage } from '../llm/anthropic.js';
import { Mask } from '../masks/schema.js';
import { buildCatalog, getMask } from '../masks/library.js';
import { DiffResult, diffAgainstMask, stripMarkers } from './diff.js';
import {
  GENERATION_RULES,
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
  const mask = parsed.mask_id === 'nenhuma' ? null : (getMask(masks, parsed.mask_id) ?? null);
  return {
    mask,
    confianca: parsed.confianca,
    durationMs: performance.now() - t0,
    usage: result.usage,
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
  const result = await llm.complete({
    model: p.model,
    system: [
      { text: GENERATION_RULES, cache: true },
      { text: generationProfileBlock(p.profileName, p.profileBody) },
    ],
    user: generationUser(p.mask.body, p.transcript, p.regras),
    maxTokens: 3000,
  });
  const reportRaw = result.text.trim();
  return {
    report: stripMarkers(reportRaw),
    reportRaw,
    diff: diffAgainstMask(p.mask.body, reportRaw),
    durationMs: performance.now() - t0,
    usage: result.usage,
  };
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
  const result = await llm.complete({
    model: p.model,
    system: [
      { text: GENERATION_RULES, cache: true },
      { text: generationProfileBlock(p.profileName, p.profileBody) },
    ],
    user: refineUser(p.currentReportRaw, p.mask.body, p.command, p.regras),
    maxTokens: 3000,
  });
  const reportRaw = result.text.trim();
  return {
    report: stripMarkers(reportRaw),
    reportRaw,
    diff: diffAgainstMask(p.mask.body, reportRaw),
    durationMs: performance.now() - t0,
    usage: result.usage,
  };
}
