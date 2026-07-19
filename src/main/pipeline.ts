/**
 * Ponte entre o app Electron e o core: áudio/texto → laudo pronto.
 * Recarrega máscaras/regras a cada laudo (edições nos .md valem na hora).
 * Gates da Fase A: sanitização do ditado antes de qualquer LLM e política de
 * confiança (alta gera; media pede confirmação; baixa nunca gera).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeComando } from '../core/anonymizer/anonymizer.js';
import { Config, loadConfig } from '../core/config/schema.js';
import { loadProfile, loadRegras } from '../core/contexto.js';
import { stripMarkers } from '../core/engine/diff.js';
import { generate, refine, selectMask } from '../core/engine/engine.js';
import { LLMClient, LLMUsage, estimateCostUSD } from '../core/llm/anthropic.js';
import { getMask, loadLibrary } from '../core/masks/library.js';
import { matchLocal, rankMasks } from '../core/masks/matcher.js';
import { Mask } from '../core/masks/schema.js';
import { OpenAISTT } from '../core/stt/openai.js';

export interface ResultadoLaudo {
  tipo: 'laudo';
  report: string;
  transcript: string;
  maskId: string;
  maskNome: string;
  confianca: string;
  blocosAlterados: string[];
  /** Avisos ao médico (sanitização do comando + validador do laudo). */
  avisos: string[];
  tempos: { sttMs: number; selecaoMs: number; geracaoMs: number };
  custoUSD: number;
}

/** Seleção com confiança média: o médico confirma a máscara antes de gerar. */
export interface PedidoConfirmacao {
  tipo: 'confirmar-mascara';
  transcript: string;
  confianca: 'media';
  /** Sugerida do modelo em primeiro; demais do ranking local. */
  candidatos: { id: string; nome: string }[];
  avisos: string[];
}

export type ResultadoPipeline = ResultadoLaudo | PedidoConfirmacao;

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
    throw new Error(`chave ${nome} não configurada — abra Configurações → Chaves de API pelo menu da bandeja`);
  }
}

export function processarTexto(transcript: string): Promise<ResultadoPipeline> {
  return processarTranscript(transcript, 0);
}

export async function processarAudio(audio: Buffer): Promise<ResultadoPipeline> {
  exigirChave('OPENAI_API_KEY');
  const config = getConfig();
  const tmp = join(tmpdir(), `aerolince-${Date.now()}.webm`);
  writeFileSync(tmp, audio);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribe(tmp);
  if (!r.text) throw new Error('não entendi o áudio — tente de novo');
  return processarTranscript(r.text, r.durationMs);
}

interface Selecao {
  mask: Mask;
  confianca: string;
  durationMs: number;
  usage: LLMUsage | null;
}

async function processarTranscript(transcript: string, sttMs: number): Promise<ResultadoPipeline> {
  exigirChave('ANTHROPIC_API_KEY');
  const config = getConfig();
  const masks = loadLibrary(config.masksDir);
  const san = sanitizeComando(transcript);
  const llm = new LLMClient();

  const local = matchLocal(san.texto, masks);
  const sel = local
    ? { mask: local, confianca: 'alta' as const, durationMs: 0, usage: null }
    : await selectMask(llm, config.llm.selectionModel, san.texto, masks);
  if (!sel.mask || sel.confianca === 'baixa') {
    throw new Error(
      'não tive certeza do exame — repita o comando citando o nome do exame (ex.: "tomografia de abdome total com contraste, …")',
    );
  }
  if (sel.confianca === 'media') {
    const candidatos = [{ id: sel.mask.id, nome: sel.mask.nome }];
    for (const m of rankMasks(san.texto, masks)) {
      if (candidatos.length >= 3) break;
      if (!candidatos.some((c) => c.id === m.id)) candidatos.push({ id: m.id, nome: m.nome });
    }
    return { tipo: 'confirmar-mascara', transcript: san.texto, confianca: 'media', candidatos, avisos: san.avisos };
  }
  return gerarLaudo(llm, config, { mask: sel.mask, confianca: sel.confianca, durationMs: sel.durationMs, usage: sel.usage }, san.texto, sttMs, san.avisos);
}

/** Geração com máscara escolhida explicitamente pelo médico (gate de confiança). */
export async function gerarComMascara(maskId: string, transcript: string): Promise<ResultadoLaudo> {
  exigirChave('ANTHROPIC_API_KEY');
  const config = getConfig();
  const masks = loadLibrary(config.masksDir);
  const mask = getMask(masks, maskId);
  if (!mask) throw new Error(`máscara não encontrada: ${maskId}`);
  const san = sanitizeComando(transcript);
  const llm = new LLMClient();
  return gerarLaudo(llm, config, { mask, confianca: 'manual', durationMs: 0, usage: null }, san.texto, 0, san.avisos);
}

async function gerarLaudo(
  llm: LLMClient,
  config: Config,
  sel: Selecao,
  transcript: string,
  sttMs: number,
  avisosSanitizacao: string[],
): Promise<ResultadoLaudo> {
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
    tipo: 'laudo',
    report: gen.report,
    transcript,
    maskId: sel.mask.id,
    maskNome: sel.mask.nome,
    confianca: sel.confianca,
    blocosAlterados: gen.diff.changed,
    avisos: [...avisosSanitizacao, ...gen.avisos],
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
  const san = sanitizeComando(command);
  const llm = new LLMClient();
  const gen = await refine(llm, {
    mask: sessao.mask,
    currentReportRaw: sessao.versions[sessao.versions.length - 1]!,
    command: san.texto,
    profileName: sessao.profileName,
    profileBody: sessao.profileBody,
    model: config.llm.generationModel,
    regras: sessao.regras,
  });
  sessao.versions.push(gen.reportRaw);
  return {
    tipo: 'laudo',
    report: gen.report,
    transcript: san.texto,
    maskId: sessao.mask.id,
    maskNome: sessao.mask.nome,
    confianca: 'refino',
    blocosAlterados: gen.diff.changed,
    avisos: [...san.avisos, ...gen.avisos],
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
    tipo: 'laudo',
    report: stripMarkers(raw),
    transcript: '(desfazer)',
    maskId: sessao.mask.id,
    maskNome: sessao.mask.nome,
    confianca: 'desfeito',
    blocosAlterados: [],
    avisos: [],
    tempos: { sttMs: 0, selecaoMs: 0, geracaoMs: 0 },
    custoUSD: 0,
  };
}
