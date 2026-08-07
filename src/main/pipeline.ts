/**
 * Ponte entre o app Electron e o core: áudio/texto → laudo pronto.
 * Recarrega máscaras/regras a cada laudo (edições nos .md valem na hora).
 * Gates da Fase A: sanitização do ditado antes de qualquer LLM e política de
 * confiança (alta gera; media pede confirmação; baixa nunca gera).
 */
import { sanitizeComando } from '../core/anonymizer/anonymizer.js';
import { duracaoMs } from '../core/audio/pcm.js';
import { Config, loadConfig } from '../core/config/schema.js';
import { loadProfile, loadRegras } from '../core/contexto.js';
import { avisosDeCaptura, contarPalavras } from '../core/engine/avisos-captura.js';
import { stripMarkers } from '../core/engine/diff.js';
import { generate, refine, selectMask } from '../core/engine/engine.js';
import { estimateCostUSD } from '../core/llm/anthropic.js';
import { chavesNecessarias, criarLLM } from '../core/llm/factory.js';
import type { LLMProvider } from '../core/llm/types.js';
import type { LLMUsage } from '../core/llm/types.js';
import { AVISO_BIBLIOTECA_VAZIA, bibliotecasDe, contarMascaras, getMask, loadLibrary } from '../core/masks/library.js';
import { matchLocal, rankMasks } from '../core/masks/matcher.js';
import { Mask } from '../core/masks/schema.js';
import { validarAudio } from '../core/stt/audio-guard.js';
import { OpenAISTT, type STTProvider } from '../core/stt/openai.js';
import { estimateSttCostUSD } from '../core/stt/pricing.js';
import type { DiagnosticoAudio } from './audio/diagnostico.js';

/** Telemetria do ditado segmentado (só no fluxo por voz; vai ao sidecar). */
export interface TelemetriaAudio {
  capturedMs: number;
  speechMs: number;
  speechRatio: number;
  uploadedBytes: number;
  segmentosStt: number;
  custoSttUSD?: number;
  /** Diagnóstico de captura (VAD) — ver `src/main/audio/diagnostico.ts`. Ausente quando o
   *  renderer não enviou (ex.: recovery de spool órfão no boot, sem sessão de renderer viva). */
  diagnostico?: DiagnosticoAudio;
}

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
  /** Só presente no ditado segmentado (Task 8) — captura/fala/upload/custo STT. */
  audio?: TelemetriaAudio;
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

/** Gate BYOK: exige TODAS as chaves do modo configurado (OpenAI sempre; Anthropic só no motor padrão). */
export function exigirChaves(config: Config): void {
  for (const nome of chavesNecessarias(config)) exigirChave(nome);
}

export function processarTexto(transcript: string): Promise<ResultadoPipeline> {
  return processarTranscript(transcript, 0);
}

export async function processarAudio(audio: Buffer): Promise<ResultadoPipeline> {
  const config = getConfig();
  exigirChaves(config);
  validarAudio(audio.byteLength);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribeBuffer(audio, 'ditado.webm');
  if (!r.text) throw new Error('não entendi o áudio — tente de novo');
  const res = await processarTranscript(r.text, r.durationMs);
  // Custo STT via usage de tokens (duração do webm é desconhecida — sem audioMs).
  const custoStt = estimateSttCostUSD(config.stt.model, { usage: r.usage });
  if (res.tipo === 'laudo' && custoStt !== null) {
    res.custoUSD = Number((res.custoUSD + custoStt).toFixed(4));
  }
  return res;
}

const CAUDA_CHARS = 150; // contexto do trecho anterior no prompt (limite de prompt do STT é curto)

/**
 * Transcreve N WAVs (quase sempre 1) em sequência, encadeando a cauda do
 * transcript anterior como `promptExtra` para dar contexto ao próximo trecho.
 * Custo somado por `usage` de tokens (fallback USD/min via duração do WAV).
 * `validarAudio` roda em TODOS os WAVs antes de qualquer upload — o caso "sem
 * áudio" (WAV de 44 bytes) dispara o guard existente sem chamar a API.
 */
export async function transcreverConsolidado(
  stt: STTProvider,
  wavs: Buffer[],
  model: string,
): Promise<{ transcript: string; sttMs: number; custoSttUSD?: number; uploadedBytes: number }> {
  for (const wav of wavs) validarAudio(wav.byteLength);
  let transcript = '';
  let sttMs = 0;
  let uploadedBytes = 0;
  let custoSttUSD: number | undefined;
  for (const wav of wavs) {
    // A cauda vira promptExtra do STT (API externa) → passa pelo anonymizer antes (regra do
    // CLAUDE.md). Sanitiza o transcript inteiro e então corta, para pegar um identificador que
    // caísse dentro da janela de CAUDA_CHARS.
    const cauda = transcript ? sanitizeComando(transcript).texto.slice(-CAUDA_CHARS) : undefined;
    const r = await stt.transcribeBuffer(wav, 'ditado.wav', cauda);
    transcript = transcript ? `${transcript} ${r.text}` : r.text;
    sttMs += r.durationMs;
    uploadedBytes += wav.byteLength;
    const custo = estimateSttCostUSD(model, {
      usage: r.usage,
      audioMs: duracaoMs((wav.byteLength - 44) / 2),
    });
    if (custo !== null) custoSttUSD = (custoSttUSD ?? 0) + custo;
  }
  return { transcript, sttMs, custoSttUSD, uploadedBytes };
}

/**
 * Pipeline do ditado segmentado: WAVs consolidados → transcrição encadeada →
 * seleção/geração (mesma rota do texto). Enriquece o laudo com o custo STT
 * (somado ao `custoUSD`) e a telemetria de áudio (sidecar). Preserva o fluxo
 * `ResultadoPipeline`: se a confiança for média, devolve o pedido de confirmação
 * intocado (a telemetria só se aplica ao laudo entregue).
 */
export async function processarAudioSegmentado(
  wavs: Buffer[],
  tele: { capturedMs: number; speechMs: number; diagnostico?: DiagnosticoAudio },
): Promise<ResultadoPipeline> {
  const config = getConfig();
  exigirChaves(config);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const t = await transcreverConsolidado(stt, wavs, config.stt.model);
  const res = await processarTranscript(t.transcript, t.sttMs);
  if (res.tipo === 'laudo') {
    if (t.custoSttUSD) res.custoUSD = Number((res.custoUSD + t.custoSttUSD).toFixed(4));
    res.audio = {
      capturedMs: tele.capturedMs,
      speechMs: tele.speechMs,
      speechRatio: tele.capturedMs > 0 ? tele.speechMs / tele.capturedMs : 1,
      uploadedBytes: t.uploadedBytes,
      segmentosStt: wavs.length,
      custoSttUSD: t.custoSttUSD,
      diagnostico: tele.diagnostico,
    };
    // Reavalia `avisosDeCaptura` agora COM a telemetria de áudio (regras b e c —
    // só existem neste fluxo). A regra (a) recalculada aqui é idêntica à já
    // anexada em `gerarLaudo` (mesmo transcript/blocosAlterados) — `dedupAvisos`
    // descarta a repetição, sobrando só os avisos novos.
    const avisosComAudio = avisosDeCaptura({
      palavrasDitadas: contarPalavras(res.transcript),
      blocosAlterados: res.blocosAlterados,
      audio: res.audio,
      segmentosRecusados: tele.diagnostico?.segmentosRecusados,
    });
    res.avisos = dedupAvisos(res.avisos, avisosComAudio);
  }
  return res;
}

interface Selecao {
  mask: Mask;
  confianca: string;
  durationMs: number;
  usage: LLMUsage | null;
}

async function processarTranscript(transcript: string, sttMs: number): Promise<ResultadoPipeline> {
  const config = getConfig();
  exigirChaves(config);
  const masks = loadLibrary(bibliotecasDe(config));
  const san = sanitizeComando(transcript);
  const avisos = dedupAvisos(san.avisos, contarMascaras(config.masksDir) === 0 ? [AVISO_BIBLIOTECA_VAZIA] : []);
  const { llm, modelos } = criarLLM(config);

  const local = matchLocal(san.texto, masks);
  const sel = local
    ? { mask: local, confianca: 'alta' as const, durationMs: 0, usage: null }
    : await selectMask(llm, modelos.selecao, san.texto, masks);
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
    return { tipo: 'confirmar-mascara', transcript: san.texto, confianca: 'media', candidatos, avisos };
  }
  return gerarLaudo(
    llm,
    config,
    modelos,
    { mask: sel.mask, confianca: sel.confianca, durationMs: sel.durationMs, usage: sel.usage },
    san.texto,
    sttMs,
    avisos,
  );
}

/**
 * Combina listas de avisos preservando a ordem e removendo duplicatas exatas.
 * Usada para não perder os avisos da sanitização original (feita antes da
 * confirmação de máscara) quando `gerarComMascara` roda uma segunda passagem
 * sobre um transcript já redigido (que não tem mais o que encontrar).
 */
export function dedupAvisos(...listas: string[][]): string[] {
  return [...new Set(listas.flat())];
}

/**
 * Geração com máscara escolhida explicitamente pelo médico (gate de confiança).
 * `avisosPrevios` carrega os avisos da sanitização original (calculada em
 * `processarTranscript` antes do pedido de confirmação) — o transcript aqui já
 * chega redigido, então uma segunda `sanitizeComando` não reencontra nome/CPF/
 * ID/CRM/telefone (já viraram `[NOME]` etc.); sem repassar `avisosPrevios` o
 * médico nunca saberia que um identificador foi removido.
 */
export async function gerarComMascara(
  maskId: string,
  transcript: string,
  avisosPrevios: string[] = [],
): Promise<ResultadoLaudo> {
  const config = getConfig();
  exigirChaves(config);
  const masks = loadLibrary(bibliotecasDe(config));
  const mask = getMask(masks, maskId);
  if (!mask) throw new Error(`máscara não encontrada: ${maskId}`);
  const san = sanitizeComando(transcript);
  const { llm, modelos } = criarLLM(config);
  const avisos = dedupAvisos(
    avisosPrevios,
    san.avisos,
    contarMascaras(config.masksDir) === 0 ? [AVISO_BIBLIOTECA_VAZIA] : [],
  );
  return gerarLaudo(llm, config, modelos, { mask, confianca: 'manual', durationMs: 0, usage: null }, san.texto, 0, avisos);
}

async function gerarLaudo(
  llm: LLMProvider,
  config: Config,
  modelos: { selecao: string; geracao: string; rapido: string },
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
    model: modelos.geracao,
    regras,
  });

  sessao = {
    mask: sel.mask,
    regras,
    profileName: profile.name,
    profileBody: profile.body,
    versions: [gen.reportRaw],
  };

  const custoSel = sel.usage ? estimateCostUSD(modelos.selecao, sel.usage) : 0;
  const custoGer = estimateCostUSD(modelos.geracao, gen.usage);
  const avisosCusto =
    custoSel === null || custoGer === null
      ? ['custo não estimado — o modelo configurado não está na tabela de preços']
      : [];
  // Regra (a) de `avisosDeCaptura`: sem telemetria de áudio aqui (só existe no
  // ditado segmentado, anexada depois em `processarAudioSegmentado`) — cobre
  // igualmente processarTexto/processarAudio (clássico) e gerarComMascara, que
  // passam todos por esta função.
  const avisosCaptura = avisosDeCaptura({ palavrasDitadas: contarPalavras(transcript), blocosAlterados: gen.diff.changed });

  return {
    tipo: 'laudo',
    report: gen.report,
    transcript,
    maskId: sel.mask.id,
    maskNome: sel.mask.nome,
    confianca: sel.confianca,
    blocosAlterados: gen.diff.changed,
    avisos: [...avisosSanitizacao, ...avisosCaptura, ...gen.avisos, ...avisosCusto],
    tempos: {
      sttMs: Math.round(sttMs),
      selecaoMs: Math.round(sel.durationMs),
      geracaoMs: Math.round(gen.durationMs),
    },
    custoUSD: Number(((custoSel ?? 0) + (custoGer ?? 0)).toFixed(4)),
  };
}

export function getOutputDir(): string {
  return getConfig().outputDir;
}

async function refinarTranscript(command: string, sttMs: number): Promise<ResultadoLaudo> {
  if (!sessao) throw new Error('nenhum laudo nesta sessão para refinar — gere um laudo primeiro');
  const config = getConfig();
  exigirChaves(config);
  const san = sanitizeComando(command);
  const { llm, modelos } = criarLLM(config);
  const gen = await refine(llm, {
    mask: sessao.mask,
    currentReportRaw: sessao.versions[sessao.versions.length - 1]!,
    command: san.texto,
    profileName: sessao.profileName,
    profileBody: sessao.profileBody,
    model: modelos.geracao,
    regras: sessao.regras,
  });
  sessao.versions.push(gen.reportRaw);
  const custoRef = estimateCostUSD(modelos.geracao, gen.usage);
  return {
    tipo: 'laudo',
    report: gen.report,
    transcript: san.texto,
    maskId: sessao.mask.id,
    maskNome: sessao.mask.nome,
    confianca: 'refino',
    blocosAlterados: gen.diff.changed,
    avisos: [
      ...san.avisos,
      ...gen.avisos,
      ...(custoRef === null ? ['custo não estimado — o modelo configurado não está na tabela de preços'] : []),
    ],
    tempos: { sttMs: Math.round(sttMs), selecaoMs: 0, geracaoMs: Math.round(gen.durationMs) },
    custoUSD: Number((custoRef ?? 0).toFixed(4)),
  };
}

export function refinarTexto(command: string): Promise<ResultadoLaudo> {
  return refinarTranscript(command, 0);
}

export async function refinarAudio(audio: Buffer): Promise<ResultadoLaudo> {
  const config = getConfig();
  exigirChaves(config);
  validarAudio(audio.byteLength);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribeBuffer(audio, 'refino.webm');
  if (!r.text) throw new Error('não entendi o áudio do refino — tente de novo');
  const res = await refinarTranscript(r.text, r.durationMs);
  // Custo STT via usage de tokens (só no refino por voz; sem audioMs — webm sem duração).
  const custoStt = estimateSttCostUSD(config.stt.model, { usage: r.usage });
  if (custoStt !== null) res.custoUSD = Number((res.custoUSD + custoStt).toFixed(4));
  return res;
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
