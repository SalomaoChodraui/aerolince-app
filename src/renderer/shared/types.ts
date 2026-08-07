/** Forma da config exposta ao renderer (espelha core/config/schema.ts). */
export interface Macro {
  id: string;
  nome: string;
  comando: string;
}

export interface UIConfig {
  tema: 'auto' | 'claro' | 'escuro';
  liquidGlass: boolean;
  opacidadeBalao: number;
  atalho: string;
  balaoPos: { x: number; y: number } | null;
}

export type SensibilidadeVad = 'alta' | 'media' | 'baixa';

export interface SttConfig {
  model: string;
  glossario: string[];
  captura: 'segmentada' | 'classica';
  pausaMs: number;
  sensibilidadeVad: SensibilidadeVad;
}

export interface HistoricoConfig {
  retencaoDias: number;
}

export interface OnboardingConfig {
  versao: number;
  passo: number;
  acervoImportado: boolean;
}

export interface LlmConfig {
  provider: 'anthropic' | 'openai';
  selectionModel: string;
  generationModel: string;
  fastModel: string;
}

export interface RendererConfig {
  masksDir: string;
  profilesDir: string;
  outputDir: string;
  bibliotecaBaseDir: string;
  acervoDir: string;
  perfilPadrao: string;
  onboardingConcluido: boolean;
  ui: UIConfig;
  macros: Macro[];
  stt: SttConfig;
  llm: LlmConfig;
  historico: HistoricoConfig;
  onboarding: OnboardingConfig;
}
