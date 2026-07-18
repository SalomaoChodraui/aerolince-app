/**
 * Ponte entre o app Electron e o core: áudio/texto → laudo pronto.
 * Recarrega máscaras/regras a cada laudo (edições nos .md valem na hora).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, loadConfig } from '../core/config/schema.js';
import { loadProfile, loadRegras } from '../core/contexto.js';
import { stripMarkers } from '../core/engine/diff.js';
import { generate, refine, selectMask } from '../core/engine/engine.js';
import { LLMClient, estimateCostUSD } from '../core/llm/anthropic.js';
import { loadLibrary } from '../core/masks/library.js';
import { matchLocal } from '../core/masks/matcher.js';
import { Mask } from '../core/masks/schema.js';
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

/** Sessão do último laudo — base para refino por voz e desfazer. */
interface Sessao {
  mask: Mask;
  regras?: string;
  profileName: string;
  profileBody: string;
  versions: string[]; // reportRaw de cada versão (com marcadores)
}
let sessao: Sessao | null = null;

function getConfig(): Config {
  return loadConfig(appRoot);
}

function exigirChave(nome: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'): void {
  if (!process.env[nome]) {
    throw new Error(`chave ${nome} não configurada — edite o arquivo .env em ${appRoot} e reabra o app`);
  }
}

export function processarTexto(transcript: string): Promise<ResultadoLaudo> {
  return processarTranscript(transcript, 0);
}

export async function processarAudio(audio: Buffer): Promise<ResultadoLaudo> {
  exigirChave('OPENAI_API_KEY');
  const config = getConfig();
  const tmp = join(tmpdir(), `aerolince-${Date.now()}.webm`);
  writeFileSync(tmp, audio);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribe(tmp);
  if (!r.text) throw new Error('não entendi o áudio — tente de novo');
  return processarTranscript(r.text, r.durationMs);
}

async function processarTranscript(transcript: string, sttMs: number): Promise<ResultadoLaudo> {
  exigirChave('ANTHROPIC_API_KEY');
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

  sessao = {
    mask: sel.mask,
    regras,
    profileName: profile.name,
    profileBody: profile.body,
    versions: [gen.reportRaw],
  };

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

async function refinarTranscript(command: string, sttMs: number): Promise<ResultadoLaudo> {
  if (!sessao) throw new Error('nenhum laudo nesta sessão para refinar — gere um laudo primeiro');
  const config = getConfig();
  const llm = new LLMClient();
  const gen = await refine(llm, {
    mask: sessao.mask,
    currentReportRaw: sessao.versions[sessao.versions.length - 1]!,
    command,
    profileName: sessao.profileName,
    profileBody: sessao.profileBody,
    model: config.llm.generationModel,
    regras: sessao.regras,
  });
  sessao.versions.push(gen.reportRaw);
  return {
    report: gen.report,
    transcript: command,
    maskId: sessao.mask.id,
    maskNome: sessao.mask.nome,
    confianca: 'refino',
    blocosAlterados: gen.diff.changed,
    tempos: { sttMs: Math.round(sttMs), selecaoMs: 0, geracaoMs: Math.round(gen.durationMs) },
    custoUSD: Number(estimateCostUSD(config.llm.generationModel, gen.usage).toFixed(4)),
  };
}

export function refinarTexto(command: string): Promise<ResultadoLaudo> {
  return refinarTranscript(command, 0);
}

export async function refinarAudio(audio: Buffer): Promise<ResultadoLaudo> {
  exigirChave('OPENAI_API_KEY');
  const config = getConfig();
  const tmp = join(tmpdir(), `aerolince-refino-${Date.now()}.webm`);
  writeFileSync(tmp, audio);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribe(tmp);
  if (!r.text) throw new Error('não entendi o áudio do refino — tente de novo');
  return refinarTranscript(r.text, r.durationMs);
}

/** Volta uma versão do laudo da sessão (ou null se não houver o que desfazer). */
export function desfazer(): ResultadoLaudo | null {
  if (!sessao || sessao.versions.length < 2) return null;
  sessao.versions.pop();
  const raw = sessao.versions[sessao.versions.length - 1]!;
  return {
    report: stripMarkers(raw),
    transcript: '(desfazer)',
    maskId: sessao.mask.id,
    maskNome: sessao.mask.nome,
    confianca: 'desfeito',
    blocosAlterados: [],
    tempos: { sttMs: 0, selecaoMs: 0, geracaoMs: 0 },
    custoUSD: 0,
  };
}
