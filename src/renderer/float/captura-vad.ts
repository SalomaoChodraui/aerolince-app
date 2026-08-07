import { MicVAD } from '@ricky0123/vad-web';
import { duracaoMs, fatiarPcm, float32ParaInt16, SAMPLE_RATE } from '../../core/audio/pcm.js';
import type { SensibilidadeVad } from '../shared/types.js';
import { PARAMETROS_POR_SENSIBILIDADE } from './vad-sensibilidade.js';

// Fala contínua acima disto é fatiada antes de enviar: um único segmento >~2 min estoura o cap
// de tamanho do IPC/main e seria recusado. 60 s viram segmentos contíguos na consolidação (sem
// overlap, gap curto entre eles) — perda de conteúdo zero.
const MAX_AMOSTRAS_SEGMENTO = 60 * SAMPLE_RATE;

export interface CapturaVad {
  /** Encerra flushando o segmento em andamento (submitUserSpeechOnPause). */
  parar(): Promise<void>;
  /** Encerra descartando tudo (Esc). */
  cancelar(): Promise<void>;
}

export interface OpcoesCaptura {
  pausaMs: number; // silêncio que fecha um trecho (config.stt.pausaMs)
  sensibilidade: SensibilidadeVad; // config.stt.sensibilidadeVad — ver vad-sensibilidade.ts
  aoFalar(): void;
  aoSilenciar(): void;
  aoSegmento(pcm: Int16Array, durationMs: number): void;
  /** onVADMisfire: início de fala detectado, mas curto demais (< minSpeechMs) — vira ruído
   *  descartado, não um segmento. Contado à parte de `aoSilenciar` para o diagnóstico. */
  aoMisfire(): void;
}

// Usar a expressão EXATA validada no spike da Task 1 (assets 100% locais, sem CDN,
// em dev via middleware `servirAssetsVadDev` e no empacotado via `file://`+app.asar).
const BASE = import.meta.env.DEV ? '/vad/' : new URL('../vad/', location.href).toString();

export async function iniciarCapturaVad(opts: OpcoesCaptura): Promise<CapturaVad> {
  const params = PARAMETROS_POR_SENSIBILIDADE[opts.sensibilidade];
  const vad = await MicVAD.new({
    model: 'v5',
    baseAssetPath: BASE,
    onnxWASMBasePath: BASE,
    redemptionMs: opts.pausaMs, // silêncio que fecha o segmento
    positiveSpeechThreshold: params.positiveSpeechThreshold,
    negativeSpeechThreshold: params.negativeSpeechThreshold,
    preSpeechPadMs: params.preSpeechPadMs, // não corta a primeira sílaba
    minSpeechMs: params.minSpeechMs, // estalos/cliques não viram segmento
    submitUserSpeechOnPause: true, // parar() no meio de uma fala flusha o trecho via onSpeechEnd
    onSpeechStart: () => opts.aoFalar(),
    onVADMisfire: () => {
      opts.aoSilenciar();
      opts.aoMisfire();
    },
    onSpeechEnd: (audio: Float32Array) => {
      opts.aoSilenciar();
      const pcm = float32ParaInt16(audio); // novo array → .buffer tem o tamanho exato
      // Fala longa vira vários segmentos ≤60 s (cada um com sua duração proporcional) para não
      // ser recusada pelos caps do IPC/main; fala curta passa como um único segmento intacto.
      for (const parte of fatiarPcm(pcm, MAX_AMOSTRAS_SEGMENTO)) {
        opts.aoSegmento(parte, duracaoMs(parte.length));
      }
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
