/**
 * Avisos de segurança clínica sobre a CAPTURA do ditado — não sobre o conteúdo
 * do laudo. Nasceu de um caso real (smoke test 2026-08): o VAD descartou ~81%
 * da fala do médico, a transcrição ficou curta e o laudo saiu = máscara normal,
 * sem NENHUM aviso. O médico quase assinou um laudo que não refletia o ditado.
 *
 * Duas regras independentes (podem coexistir):
 *   (a) o médico ditou o bastante, mas nada no laudo mudou — sinal forte de que
 *       a captura falhou (ou o STT devolveu lixo) ANTES de chegar ao motor de
 *       geração. Não dispara para ditados curtos legítimos (ex.: "tomografia de
 *       crânio normal" — exame realmente normal, poucas palavras, zero blocos).
 *   (b) a telemetria de áudio (só existe no ditado segmentado) mostra que boa
 *       parte da fala captada pelo microfone nunca virou segmento de fala para
 *       o VAD — o médico falou mais do que o app ouviu.
 */

/** Telemetria mínima que a regra (b) precisa — ver `TelemetriaAudio` em `src/main/pipeline.ts`. */
export interface TelemetriaParaAviso {
  capturedMs: number;
  speechMs: number;
  speechRatio: number;
}

export interface EntradaAvisosCaptura {
  /** Quantas palavras o médico ditou (transcript já sanitizado). */
  palavrasDitadas: number;
  /** Ids dos blocos de órgão que o motor de geração efetivamente alterou. */
  blocosAlterados: string[];
  /** Só presente no ditado segmentado — ausente no fluxo de texto/clássico. */
  audio?: TelemetriaParaAviso;
}

// Ditado de exame normal legítimo é curto ("tomografia de crânio normal" = 4
// palavras, zero blocos alterados) — o limiar evita falso-positivo nesse caso
// enquanto ainda pega o caso real do smoke test (13 palavras, zero blocos).
const PALAVRAS_MINIMAS_PARA_AVISO_SEM_ALTERACAO = 8;

// Só avisa sobre fala não captada em sessões longas o bastante para o ratio
// ser significativo (evita ruído estatístico em ditados de poucos segundos).
const CAPTURED_MS_MINIMO_PARA_AVISO_SPEECH = 15_000;
const SPEECH_RATIO_MINIMO = 0.35;

function avisoSemAlteracao(palavrasDitadas: number): string {
  return (
    `você ditou ${palavrasDitadas} palavras, mas NENHUMA alteração foi aplicada — ` +
    'o laudo abaixo é a máscara normal. Confira se o ditado foi captado antes de assinar.'
  );
}

function avisoFalaNaoCaptada(audio: TelemetriaParaAviso): string {
  const capturados = Math.round(audio.capturedMs / 1000);
  const falados = Math.round(audio.speechMs / 1000);
  return (
    `boa parte da sua fala não foi captada (${falados}s de ${capturados}s) — aproxime o microfone, ` +
    'aumente a sensibilidade em Configurações → Ditado, ou use a captura Clássica.'
  );
}

/** Função pura — sem I/O, fácil de testar isoladamente do pipeline/Electron. */
export function avisosDeCaptura({ palavrasDitadas, blocosAlterados, audio }: EntradaAvisosCaptura): string[] {
  const avisos: string[] = [];
  if (blocosAlterados.length === 0 && palavrasDitadas >= PALAVRAS_MINIMAS_PARA_AVISO_SEM_ALTERACAO) {
    avisos.push(avisoSemAlteracao(palavrasDitadas));
  }
  if (
    audio &&
    audio.capturedMs > CAPTURED_MS_MINIMO_PARA_AVISO_SPEECH &&
    audio.speechRatio < SPEECH_RATIO_MINIMO
  ) {
    avisos.push(avisoFalaNaoCaptada(audio));
  }
  return avisos;
}

/** Contagem simples de palavras (tokens separados por espaço) do transcript sanitizado. */
export function contarPalavras(texto: string): number {
  const t = texto.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}
