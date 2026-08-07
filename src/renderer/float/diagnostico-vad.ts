import type { SensibilidadeVad } from '../shared/types.js';
import { PARAMETROS_POR_SENSIBILIDADE } from './vad-sensibilidade.js';

/**
 * Capacidades do ambiente de áudio do renderer, colhidas fora deste módulo
 * (AudioContext/enumerateDevices — DOM, não testável em Node puro). `microfone`
 * é nome de DISPOSITIVO, nunca dado de paciente; null quando indisponível.
 */
export interface CapacidadesAudio {
  sampleRateNativo: number | null;
  audioWorkletDisponivel: boolean;
  microfone: string | null;
}

/** Contadores acumulados durante a sessão de ditado segmentado (VAD). */
export interface ContadoresVad {
  /** Cada trecho que o VAD emitiu (onSpeechEnd → envio ao main), aceito ou não. */
  segmentosVadEmitidos: number;
  segmentosAceitos: number;
  segmentosRecusados: number;
  /** onVADMisfire: início de fala detectado, mas curto demais (< minSpeechMs) — descartado como ruído. */
  misfires: number;
}

/** Payload enviado ao main junto de `sessaoEncerrar` — vira `audio.diagnostico` no sidecar. */
export interface DiagnosticoVad extends ContadoresVad, CapacidadesAudio {
  sensibilidade: SensibilidadeVad;
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechMs: number;
  preSpeechPadMs: number;
}

/**
 * Função pura: junta os contadores da sessão, os parâmetros EFETIVOS do VAD
 * (a tabela de sensibilidade já resolvida — ver `vad-sensibilidade.ts`) e as
 * capacidades do ambiente num único payload de diagnóstico. Isolada da coleta
 * de `capacidades` (que exige DOM) para ficar testável sem mocks pesados.
 */
export function montarDiagnostico(
  contadores: ContadoresVad,
  sensibilidade: SensibilidadeVad,
  capacidades: CapacidadesAudio,
): DiagnosticoVad {
  const params = PARAMETROS_POR_SENSIBILIDADE[sensibilidade];
  return {
    ...contadores,
    sensibilidade,
    positiveSpeechThreshold: params.positiveSpeechThreshold,
    negativeSpeechThreshold: params.negativeSpeechThreshold,
    minSpeechMs: params.minSpeechMs,
    preSpeechPadMs: params.preSpeechPadMs,
    ...capacidades,
  };
}
