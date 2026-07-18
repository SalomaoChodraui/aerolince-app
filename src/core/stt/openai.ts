import { createReadStream } from 'node:fs';
import OpenAI from 'openai';

export interface STTResult {
  text: string;
  durationMs: number;
}

export interface STTProvider {
  transcribe(audioPath: string): Promise<STTResult>;
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

  async transcribe(audioPath: string): Promise<STTResult> {
    const t0 = performance.now();
    const result = await this.client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: this.model,
      language: 'pt',
      prompt: `Ditado de laudo de tomografia computadorizada em português. Termos: ${this.glossario.join(', ')}.`,
    });
    return { text: result.text.trim(), durationMs: performance.now() - t0 };
  }
}
