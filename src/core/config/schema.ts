import { copyFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomicSync } from '../atomic-write.js';

/** Atalho/macro do médico: um comando pronto que ele aciona sem ditar. */
export const MacroSchema = z.object({
  id: z.string(),
  nome: z.string(),
  comando: z.string(),
});
export type Macro = z.infer<typeof MacroSchema>;

export const ConfigSchema = z.object({
  schemaVersion: z.number().default(1),
  masksDir: z.string(),
  profilesDir: z.string(),
  outputDir: z.string(),
  bibliotecaBaseDir: z.string(),
  perfilPadrao: z.string().default('padrao'),
  onboardingConcluido: z.boolean().default(false),
  ui: z
    .object({
      tema: z.enum(['auto', 'claro', 'escuro']).default('auto'),
      liquidGlass: z.boolean().default(true),
      opacidadeBalao: z.number().min(0.05).max(1).default(1),
      atalho: z.string().default('CommandOrControl+Shift+D'),
      balaoPos: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
    })
    .prefault({}),
  macros: z.array(MacroSchema).default([]),
  stt: z.object({
    model: z.string().default('gpt-4o-transcribe'),
    glossario: z.array(z.string()).default([]),
    captura: z.enum(['segmentada', 'classica']).default('segmentada'), // ditado do balão; refino por voz segue clássico
    pausaMs: z.number().int().min(400).max(5000).default(1200), // silêncio que fecha um trecho de fala
  }),
  llm: z.object({
    // Motor de geração: 'anthropic' (padrão — Claude gera, OpenAI transcreve) ou
    // 'openai' (provedor único: uma chave só para voz e laudos)
    provider: z.enum(['anthropic', 'openai']).default('anthropic'),
    selectionModel: z.string().default('claude-haiku-4-5'),
    // Haiku por padrão (modo patch tornou a tarefa de edição leve); para "modo
    // qualidade" com Sonnet: laudo.config.json {"llm":{"generationModel":"claude-sonnet-5"}}
    generationModel: z.string().default('claude-haiku-4-5'),
    fastModel: z.string().default('claude-haiku-4-5'),
    // Teste A/B com Kimi (Moonshot): flag --kimi na CLI + MOONSHOT_API_KEY no .env
    kimiModel: z.string().default('kimi-k2-0905-preview'),
    kimiBaseURL: z.string().default('https://api.moonshot.ai/anthropic'),
  }),
  // Retenção do histórico de laudos: apaga pares .txt+.json além do prazo na
  // limpeza do boot. 0 = manter sempre (padrão — nunca apaga por tempo).
  historico: z
    .object({ retencaoDias: z.number().int().min(0).max(3650).default(0) })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export const GLOSSARIO_PADRAO = [
  'hipoatenuante',
  'hiperatenuante',
  'hipodenso',
  'hiperdenso',
  'normodistendida',
  'colédoco',
  'esteatose',
  'diverticulite',
  'nefrolitíase',
  'ureterolitíase',
  'linfonodomegalias',
  'espondilose',
  'retrolistese',
  'unidades Hounsfield',
  'UH',
  'BI-RADS',
  'Bosniak',
  'interapofisárias',
  'fibroatelectásico',
  'pleuroapicais',
  'normoaeradas',
  'infundíbulo',
  'esfeno-etmoidais',
  'rinofaringe',
  'colecistectomia',
  'sinusopatia',
  'ASPECTS',
  'abaulamento discal',
  'hipodensidade',
  'grupamento calicial',
  'coxofemoral',
  'loja da vesícula biliar',
  'clips metálicos',
];

const CONFIG_FILE = 'laudo.config.json';
const BACKUP_FILE = 'laudo.config.json.bak';

function defaultsDe(appRoot: string) {
  return {
    masksDir: resolve(appRoot, '..', 'biblioteca-mascaras'),
    profilesDir: resolve(appRoot, 'perfis'),
    outputDir: resolve(appRoot, '..', 'Laudos Gerados'),
    bibliotecaBaseDir: resolve(appRoot, 'biblioteca-base'),
    stt: { model: 'gpt-4o-transcribe', glossario: GLOSSARIO_PADRAO },
    llm: {
      kimiModel: 'kimi-k2-0905-preview',
      kimiBaseURL: 'https://api.moonshot.ai/anthropic',
    },
  };
}

/** Migrações do overlay por schemaVersion (idempotentes). Hoje só existe a v1. */
function migrarOverlay(raw: Record<string, unknown>): Record<string, unknown> {
  return raw;
}

function mesclar(defaults: ReturnType<typeof defaultsDe>, user: Record<string, unknown>): Config {
  return ConfigSchema.parse({
    ...defaults,
    ...user,
    stt: { ...defaults.stt, ...(user['stt'] as object | undefined) },
    llm: { ...defaults.llm, ...(user['llm'] as object | undefined) },
  });
}

function parseOverlay(texto: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(texto);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('config não é um objeto');
  return migrarOverlay(raw as Record<string, unknown>);
}

/** Overlay bruto atual (sem recuperação) — base do merge do saveConfig. */
function lerOverlayBruto(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    return parseOverlay(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Carrega a configuração com recuperação: arquivo corrompido (JSON ou schema)
 * é PRESERVADO (renomeado laudo.config.corrompido-<ts>.json), o backup .bak
 * assume se for válido; sem backup, valem os defaults. Corrupção nunca
 * impede o boot (P0-06 da auditoria).
 */
export function loadConfig(appRoot: string): Config {
  const defaults = defaultsDe(appRoot);
  const file = join(appRoot, CONFIG_FILE);
  const bak = join(appRoot, BACKUP_FILE);
  if (!existsSync(file)) return mesclar(defaults, {});
  try {
    return mesclar(defaults, parseOverlay(readFileSync(file, 'utf8')));
  } catch {
    try {
      renameSync(file, join(appRoot, `laudo.config.corrompido-${Date.now()}.json`));
    } catch {
      /* não foi possível preservar o arquivo corrompido (permissão, disco, etc.) —
         segue para o backup/defaults; corrupção nunca pode impedir o boot */
    }
    if (existsSync(bak)) {
      try {
        const config = mesclar(defaults, parseOverlay(readFileSync(bak, 'utf8')));
        copyFileSync(bak, file);
        return config;
      } catch {
        /* backup também inválido — segue para defaults */
      }
    }
    return mesclar(defaults, {});
  }
}

/**
 * Aplica um patch raso à configuração persistida e devolve a config validada.
 * Valida ANTES de tocar o disco; grava com backup (.bak) e escrita atômica.
 */
export function saveConfig(appRoot: string, patch: Record<string, unknown>): Config {
  const file = join(appRoot, CONFIG_FILE);
  const atual = lerOverlayBruto(file);
  const merged: Record<string, unknown> = { ...atual, ...patch, schemaVersion: 1 };
  // Preserva os campos aninhados que a tela edita por objeto inteiro (ui/llm/stt/historico)
  for (const chave of ['ui', 'llm', 'stt', 'historico'] as const) {
    if (patch[chave]) merged[chave] = { ...((atual[chave] as object | undefined) ?? {}), ...(patch[chave] as object) };
  }
  const config = mesclar(defaultsDe(appRoot), merged); // lança se o patch for inválido — arquivo intacto
  if (existsSync(file)) copyFileSync(file, join(appRoot, BACKUP_FILE));
  writeFileAtomicSync(file, JSON.stringify(merged, null, 2));
  return config;
}
