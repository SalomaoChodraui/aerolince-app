import { createReadStream } from 'node:fs';
import OpenAI, { toFile } from 'openai';

export interface SttUsage {
  inputAudioTokens: number;
  inputTextTokens: number;
  outputTokens: number;
}

export function mapearUsage(u: unknown): SttUsage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as {
    type?: string;
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: { text_tokens?: number; audio_tokens?: number };
  };
  if (o.type !== 'tokens') return undefined;
  return {
    inputAudioTokens: o.input_token_details?.audio_tokens ?? o.input_tokens ?? 0,
    inputTextTokens: o.input_token_details?.text_tokens ?? 0,
    outputTokens: o.output_tokens ?? 0,
  };
}

export interface STTResult {
  text: string;
  durationMs: number;
  usage?: SttUsage;
}

export interface STTProvider {
  transcribe(audioPath: string, promptExtra?: string): Promise<STTResult>;
  transcribeBuffer(data: Buffer, filename?: string, promptExtra?: string): Promise<STTResult>;
}

/**
 * Transcrição via OpenAI (gpt-4o-transcribe por padrão). O `prompt` recebe o
 * glossário radiológico PT-BR para ancorar termos técnicos.
 */
export class OpenAISTT implements STTProvider {
  private client: OpenAI;

  constructor(
    private model: string,
    private glossario: string[],
    apiKey?: string,
  ) {
    this.client = new OpenAI(apiKey ? { apiKey } : undefined);
  }

  private async create(
    file: ReturnType<typeof createReadStream> | Awaited<ReturnType<typeof toFile>>,
    promptExtra?: string,
  ): Promise<STTResult> {
    const t0 = performance.now();
    const glossarioAtual = `Ditado de laudo de tomografia computadorizada em português. Termos: ${this.glossario.join(', ')}.`;
    const result = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: 'pt',
      prompt: [promptExtra, glossarioAtual].filter(Boolean).join(' '),
    });
    return {
      text: result.text.trim(),
      durationMs: performance.now() - t0,
      usage: mapearUsage((result as { usage?: unknown }).usage),
    };
  }

  async transcribe(audioPath: string, promptExtra?: string): Promise<STTResult> {
    return this.create(createReadStream(audioPath), promptExtra);
  }

  /** Do buffer direto à API — o áudio do ditado nunca toca o disco (PRIV-01). */
  async transcribeBuffer(data: Buffer, filename = 'audio.webm', promptExtra?: string): Promise<STTResult> {
    return this.create(await toFile(data, filename), promptExtra);
  }
}
