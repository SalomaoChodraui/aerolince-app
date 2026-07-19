import { createReadStream } from 'node:fs';
import OpenAI, { toFile } from 'openai';

export interface STTResult {
  text: string;
  durationMs: number;
}

export interface STTProvider {
  transcribe(audioPath: string): Promise<STTResult>;
  transcribeBuffer(data: Buffer, filename?: string): Promise<STTResult>;
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

  private async create(file: ReturnType<typeof createReadStream> | Awaited<ReturnType<typeof toFile>>): Promise<STTResult> {
    const t0 = performance.now();
    const result = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: 'pt',
      prompt: `Ditado de laudo de tomografia computadorizada em português. Termos: ${this.glossario.join(', ')}.`,
    });
    return { text: result.text.trim(), durationMs: performance.now() - t0 };
  }

  async transcribe(audioPath: string): Promise<STTResult> {
    return this.create(createReadStream(audioPath));
  }

  /** Do buffer direto à API — o áudio do ditado nunca toca o disco (PRIV-01). */
  async transcribeBuffer(data: Buffer, filename = 'audio.webm'): Promise<STTResult> {
    return this.create(await toFile(data, filename));
  }
}
