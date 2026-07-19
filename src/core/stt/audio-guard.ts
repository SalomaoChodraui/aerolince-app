/** Limite da API de transcrição da OpenAI é 25 MB — margem de segurança. */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/** Guardas antes do upload: nada de buffer vazio nem gravação sem fim (P1 AUDIO-01 parcial). */
export function validarAudio(byteLength: number): void {
  if (byteLength < 1024) throw new Error('não captei áudio — confira o microfone e tente de novo');
  if (byteLength > MAX_AUDIO_BYTES) throw new Error('gravação longa demais — dite um comando mais curto');
}
