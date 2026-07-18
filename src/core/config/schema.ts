import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

/** Atalho/macro do médico: um comando pronto que ele aciona sem ditar. */
export const MacroSchema = z.object({
  id: z.string(),
  nome: z.string(),
  comando: z.string(),
});
export type Macro = z.infer<typeof MacroSchema>;

export const ConfigSchema = z.object({
  masksDir: z.string(),
  profilesDir: z.string(),
  outputDir: z.string(),
  perfilPadrao: z.string().default('padrao'),
  onboardingConcluido: z.boolean().default(false),
  ui: z
    .object({
      tema: z.enum(['auto', 'claro', 'escuro']).default('auto'),
      liquidGlass: z.boolean().default(true),
      opacidadeBalao: z.number().min(0.35).max(1).default(1),
      atalho: z.string().default('CommandOrControl+Shift+D'),
      balaoPos: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
    })
    .prefault({}),
  macros: z.array(MacroSchema).default([]),
  stt: z.object({
    model: z.string().default('gpt-4o-transcribe'),
    glossario: z.array(z.string()).default([]),
  }),
  llm: z.object({
    selectionModel: z.string().default('claude-haiku-4-5'),
    // Haiku por padrão (modo patch tornou a tarefa de edição leve); para "modo
    // qualidade" com Sonnet: laudo.config.json {"llm":{"generationModel":"claude-sonnet-5"}}
    generationModel: z.string().default('claude-haiku-4-5'),
    fastModel: z.string().default('claude-haiku-4-5'),
    // Teste A/B com Kimi (Moonshot): flag --kimi na CLI + MOONSHOT_API_KEY no .env
    kimiModel: z.string().default('kimi-k2-0905-preview'),
    kimiBaseURL: z.string().default('https://api.moonshot.ai/anthropic'),
  }),
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

/**
 * Carrega a configuração de `laudo.config.json` (na raiz do app) se existir,
 * senão usa defaults. `appRoot` normalmente é process.cwd() (rodar via npm em app/).
 */
export function loadConfig(appRoot: string): Config {
  const defaults = {
    masksDir: resolve(appRoot, '..', 'biblioteca-mascaras'),
    profilesDir: resolve(appRoot, 'perfis'),
    outputDir: resolve(appRoot, '..', 'Laudos Gerados'),
    stt: { model: 'gpt-4o-transcribe', glossario: GLOSSARIO_PADRAO },
    llm: {
      kimiModel: 'kimi-k2-0905-preview',
      kimiBaseURL: 'https://api.moonshot.ai/anthropic',
    },
  };
  const file = join(appRoot, 'laudo.config.json');
  const user = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return ConfigSchema.parse({
    ...defaults,
    ...user,
    stt: { ...defaults.stt, ...user.stt },
    llm: { ...defaults.llm, ...user.llm },
  });
}

const CONFIG_FILE = 'laudo.config.json';

/**
 * Aplica um patch raso à configuração persistida (laudo.config.json) e devolve
 * a config resultante já validada. Usado pela tela de configurações via IPC.
 */
export function saveConfig(appRoot: string, patch: Record<string, unknown>): Config {
  const file = join(appRoot, CONFIG_FILE);
  const atual = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const merged = { ...atual, ...patch };
  // Preserva os campos aninhados que a tela edita por objeto inteiro (ui/llm/stt)
  for (const chave of ['ui', 'llm', 'stt'] as const) {
    if (patch[chave]) merged[chave] = { ...(atual[chave] ?? {}), ...(patch[chave] as object) };
  }
  writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');
  return loadConfig(appRoot);
}
