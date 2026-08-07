import type { SensibilidadeVad } from '../shared/types.js';

/**
 * Parâmetros do `FrameProcessorOptions` do @ricky0123/vad-web (model 'v5') que
 * variam por sensibilidade. Nomes conferidos em
 * node_modules/@ricky0123/vad-web/dist/frame-processor.d.ts para a versão
 * instalada (0.0.29) — batem com o que o ticket previu.
 */
export interface ParametrosVad {
  /** Prob. do Silero acima disto = fala. Menor = mais fácil disparar (capta mais). */
  positiveSpeechThreshold: number;
  /** Prob. abaixo disto = silêncio. A lib recomenda ~0,15 abaixo do positive. */
  negativeSpeechThreshold: number;
  /** Segmento mais curto que isto é descartado como estalo/ruído (onVADMisfire). */
  minSpeechMs: number;
  /** Quanto de áudio prepend antes do início detectado (não corta a 1ª sílaba). */
  preSpeechPadMs: number;
}

// Tabela de sensibilidade do microfone (Configurações → Ditado). Quanto MAIS
// baixo o threshold, mais fácil um trecho é considerado fala — bom para voz
// baixa/microfone distante, mas pode capturar ruído de fundo; quanto MAIS
// alto, mais fala fraca é descartada — bom para ambiente ruidoso, mas corre
// risco de perder parte do ditado (o defeito de campo que originou este fix).
export const PARAMETROS_POR_SENSIBILIDADE: Record<SensibilidadeVad, ParametrosVad> = {
  // Voz baixa / microfone distante — capta mais (pode pegar ruído).
  alta: { positiveSpeechThreshold: 0.3, negativeSpeechThreshold: 0.2, minSpeechMs: 200, preSpeechPadMs: 1000 },
  // Padrão.
  media: { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, minSpeechMs: 400, preSpeechPadMs: 800 },
  // Ambiente ruidoso — capta menos (exige fala mais clara para virar segmento).
  baixa: { positiveSpeechThreshold: 0.65, negativeSpeechThreshold: 0.5, minSpeechMs: 500, preSpeechPadMs: 600 },
};
