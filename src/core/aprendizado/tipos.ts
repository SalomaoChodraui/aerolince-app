/** Opções comuns a `destilarMascara` e `aprenderRegras` — compartilhadas para manter a mesma forma. */
import type { LLMProvider } from '../llm/types.js';

export interface OpcoesAprendizado {
  llm: LLMProvider;
  modelo: string;
  /** Progresso do processamento desta máscara (etapas internas, não do lote). */
  onProgresso?: (p: { etapa: string; atual: number; total: number }) => void;
  /** Checado ANTES de cada chamada de LLM — permite cancelar um lote entre itens. */
  cancelado?: () => boolean;
}

export interface ResultadoAprendizado {
  arquivo: string;
  custoUSD: number | null;
}
