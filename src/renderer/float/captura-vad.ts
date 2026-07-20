import { MicVAD } from '@ricky0123/vad-web';
import { duracaoMs, float32ParaInt16 } from '../../core/audio/pcm.js';

export interface CapturaVad {
  /** Encerra flushando o segmento em andamento (submitUserSpeechOnPause). */
  parar(): Promise<void>;
  /** Encerra descartando tudo (Esc). */
  cancelar(): Promise<void>;
}

export interface OpcoesCaptura {
  pausaMs: number; // silêncio que fecha um trecho (config.stt.pausaMs)
  aoFalar(): void;
  aoSilenciar(): void;
  aoSegmento(pcm: Int16Array, durationMs: number): void;
}

// Usar a expressão EXATA validada no spike da Task 1 (assets 100% locais, sem CDN,
// em dev via middleware `servirAssetsVadDev` e no empacotado via `file://`+app.asar).
const BASE = import.meta.env.DEV ? '/vad/' : new URL('../vad/', location.href).toString();

export async function iniciarCapturaVad(opts: OpcoesCaptura): Promise<CapturaVad> {
  const vad = await MicVAD.new({
    model: 'v5',
    baseAssetPath: BASE,
    onnxWASMBasePath: BASE,
    redemptionMs: opts.pausaMs, // silêncio que fecha o segmento
    preSpeechPadMs: 800, // não corta a primeira sílaba (default da lib)
    minSpeechMs: 400, // estalos/cliques não viram segmento
    submitUserSpeechOnPause: true, // parar() no meio de uma fala flusha o trecho via onSpeechEnd
    onSpeechStart: () => opts.aoFalar(),
    onVADMisfire: () => opts.aoSilenciar(),
    onSpeechEnd: (audio: Float32Array) => {
      opts.aoSilenciar();
      const pcm = float32ParaInt16(audio); // novo array → .buffer tem o tamanho exato
      opts.aoSegmento(pcm, duracaoMs(audio.length));
    },
  });
  vad.start();
  return {
    async parar() {
      vad.pause(); // dispara onSpeechEnd do trecho em andamento, se houver
      vad.destroy();
    },
    async cancelar() {
      vad.destroy();
    },
  };
}
