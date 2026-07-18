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

export interface RendererConfig {
  masksDir: string;
  profilesDir: string;
  outputDir: string;
  perfilPadrao: string;
  onboardingConcluido: boolean;
  ui: UIConfig;
  macros: Macro[];
}
