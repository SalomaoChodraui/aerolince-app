import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const ConfigSchema = z.object({
  masksDir: z.string(),
  profilesDir: z.string(),
  outputDir: z.string(),
  perfilPadrao: z.string().default('padrao'),
  stt: z.object({
    model: z.string().default('gpt-4o-transcribe'),
    glossario: z.array(z.string()).default([]),
  }),
  llm: z.object({
    selectionModel: z.string().default('claude-haiku-4-5'),
    generationModel: z.string().default('claude-sonnet-5'),
    fastModel: z.string().default('claude-haiku-4-5'),
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
];

/**
 * Carrega a configuração de `laudo.config.json` (na raiz do app) se existir,
 * senão usa defaults. `appRoot` normalmente é process.cwd() (rodar via npm em app/).
 */
export function loadConfig(appRoot: string): Config {
  const defaults: Config = {
    masksDir: resolve(appRoot, '..', 'biblioteca-mascaras'),
    profilesDir: resolve(appRoot, 'perfis'),
    outputDir: resolve(appRoot, '..', 'Laudos Gerados'),
    perfilPadrao: 'padrao',
    stt: { model: 'gpt-4o-transcribe', glossario: GLOSSARIO_PADRAO },
    llm: {
      selectionModel: 'claude-haiku-4-5',
      generationModel: 'claude-sonnet-5',
      fastModel: 'claude-haiku-4-5',
    },
  };
  const file = join(appRoot, 'laudo.config.json');
  if (!existsSync(file)) return defaults;
  const user = JSON.parse(readFileSync(file, 'utf8'));
  return ConfigSchema.parse({ ...defaults, ...user, stt: { ...defaults.stt, ...user.stt }, llm: { ...defaults.llm, ...user.llm } });
}
