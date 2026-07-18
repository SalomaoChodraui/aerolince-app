/**
 * Ponte entre o app Electron e o core: áudio/texto → laudo pronto.
 * Recarrega máscaras/regras a cada laudo (edições nos .md valem na hora).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, loadConfig } from '../core/config/schema.js';
import { loadProfile, loadRegras } from '../core/contexto.js';
import { generate, selectMask } from '../core/engine/engine.js';
import { LLMClient, estimateCostUSD } from '../core/llm/anthropic.js';
import { loadLibrary } from '../core/masks/library.js';
import { matchLocal } from '../core/masks/matcher.js';
import { OpenAISTT } from '../core/stt/openai.js';

export interface ResultadoLaudo {
  report: string;
  transcript: string;
  maskId: string;
  maskNome: string;
  confianca: string;
  blocosAlterados: string[];
  tempos: { sttMs: number; selecaoMs: number; geracaoMs: number };
  custoUSD: number;
}

let appRoot = process.cwd();
export function initPipeline(root: string): void {
  appRoot = root;
}

function getConfig(): Config {
  return loadConfig(appRoot);
}

export function processarTexto(transcript: string): Promise<ResultadoLaudo> {
  return processarTranscript(transcript, 0);
}

export async function processarAudio(audio: Buffer): Promise<ResultadoLaudo> {
  const config = getConfig();
  const tmp = join(tmpdir(), `aerolince-${Date.now()}.webm`);
  writeFileSync(tmp, audio);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribe(tmp);
  if (!r.text) throw new Error('não entendi o áudio — tente de novo');
  return processarTranscript(r.text, r.durationMs);
}

async function processarTranscript(transcript: string, sttMs: number): Promise<ResultadoLaudo> {
  const config = getConfig();
  const masks = loadLibrary(config.masksDir);
  const llm = new LLMClient();

  const local = matchLocal(transcript, masks);
  const sel = local
    ? { mask: local, confianca: 'alta' as const, durationMs: 0, usage: null }
    : await selectMask(llm, config.llm.selectionModel, transcript, masks);
  if (!sel.mask) {
    throw new Error(
      `não identifiquei o exame (confiança ${sel.confianca}). Diga o nome do exame no comando — ex.: "tomografia de abdome…"`,
    );
  }
  const profile = loadProfile(config, config.perfilPadrao);
  const regras = loadRegras(config, sel.mask.id);
  const gen = await generate(llm, {
    mask: sel.mask,
    transcript,
    profileName: profile.name,
    profileBody: profile.body,
    model: config.llm.generationModel,
    regras,
  });

  return {
    report: gen.report,
    transcript,
    maskId: sel.mask.id,
    maskNome: sel.mask.nome,
    confianca: sel.confianca,
    blocosAlterados: gen.diff.changed,
    tempos: {
      sttMs: Math.round(sttMs),
      selecaoMs: Math.round(sel.durationMs),
      geracaoMs: Math.round(gen.durationMs),
    },
    custoUSD: Number(
      (
        (sel.usage ? estimateCostUSD(config.llm.selectionModel, sel.usage) : 0) +
        estimateCostUSD(config.llm.generationModel, gen.usage)
      ).toFixed(4),
    ),
  };
}

export function getOutputDir(): string {
  return getConfig().outputDir;
}
