import { describe, expect, it } from 'vitest';
import { mapearUsage } from './openai.js';

describe('mapearUsage', () => {
  it('mapeia usage type=tokens do SDK', () => {
    expect(
      mapearUsage({
        type: 'tokens',
        input_tokens: 14,
        output_tokens: 45,
        total_tokens: 59,
        input_token_details: { text_tokens: 4, audio_tokens: 10 },
      }),
    ).toEqual({ inputAudioTokens: 10, inputTextTokens: 4, outputTokens: 45 });
  });

  it('type=duration (whisper-1) ou ausente → undefined', () => {
    expect(mapearUsage({ type: 'duration', seconds: 12 })).toBeUndefined();
    expect(mapearUsage(undefined)).toBeUndefined();
  });

  it('tokens sem input_token_details usa input_tokens como áudio (conservador)', () => {
    expect(mapearUsage({ type: 'tokens', input_tokens: 10, output_tokens: 2, total_tokens: 12 }))
      .toEqual({ inputAudioTokens: 10, inputTextTokens: 0, outputTokens: 2 });
  });
});
