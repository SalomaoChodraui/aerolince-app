/**
 * Diagnóstico do ditado segmentado (VAD) — colhido no renderer, validado nesta
 * fronteira IPC ('sessao-encerrar' carrega o payload) e anexado em `audio.diagnostico`
 * no sidecar. Objetivo: responder, no próximo ditado real, ONDE a fala se perde
 * (detecção do VAD vs. transporte vs. motor de laudo) — ver `src/main/pipeline.ts`.
 */
export interface DiagnosticoAudio {
  /** Cada trecho que o VAD emitiu no renderer (onSpeechEnd → envio), aceito ou não. */
  segmentosVadEmitidos: number;
  segmentosAceitos: number;
  segmentosRecusados: number;
  /** onVADMisfire: início de fala detectado, mas curto demais — descartado como ruído. */
  misfires: number;
  /** Sensibilidade configurada (Configurações → Ditado) e os parâmetros EFETIVOS aplicados. */
  sensibilidade: string;
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechMs: number;
  preSpeechPadMs: number;
  /** Capacidades do ambiente de áudio do renderer — null quando indisponível. */
  sampleRateNativo: number | null;
  audioWorkletDisponivel: boolean;
  /** Nome do dispositivo de microfone ativo — nunca dado de paciente. */
  microfone: string | null;
}

const CAMPOS_NUMERICOS = [
  'segmentosVadEmitidos',
  'segmentosAceitos',
  'segmentosRecusados',
  'misfires',
  'positiveSpeechThreshold',
  'negativeSpeechThreshold',
  'minSpeechMs',
  'preSpeechPadMs',
] as const;

/**
 * Fronteira IPC: nunca confiar no renderer. Um payload malformado (tipo errado,
 * campo faltando) vira `null` — o chamador simplesmente não anexa diagnóstico ao
 * sidecar, nunca falha a entrega do laudo por causa de telemetria.
 */
export function validarDiagnostico(d: unknown): DiagnosticoAudio | null {
  if (typeof d !== 'object' || d === null) return null;
  const o = d as Record<string, unknown>;
  for (const campo of CAMPOS_NUMERICOS) {
    if (typeof o[campo] !== 'number' || !Number.isFinite(o[campo])) return null;
  }
  if (typeof o.sensibilidade !== 'string' || o.sensibilidade === '') return null;
  if (typeof o.audioWorkletDisponivel !== 'boolean') return null;
  if (o.sampleRateNativo !== null && typeof o.sampleRateNativo !== 'number') return null;
  if (o.microfone !== null && typeof o.microfone !== 'string') return null;
  return {
    segmentosVadEmitidos: o.segmentosVadEmitidos as number,
    segmentosAceitos: o.segmentosAceitos as number,
    segmentosRecusados: o.segmentosRecusados as number,
    misfires: o.misfires as number,
    sensibilidade: o.sensibilidade,
    positiveSpeechThreshold: o.positiveSpeechThreshold as number,
    negativeSpeechThreshold: o.negativeSpeechThreshold as number,
    minSpeechMs: o.minSpeechMs as number,
    preSpeechPadMs: o.preSpeechPadMs as number,
    sampleRateNativo: o.sampleRateNativo as number | null,
    audioWorkletDisponivel: o.audioWorkletDisponivel,
    microfone: o.microfone as string | null,
  };
}
