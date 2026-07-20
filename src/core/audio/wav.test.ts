import { describe, expect, it } from 'vitest';
import { encodeWavPcm16 } from './wav.js';

describe('encodeWavPcm16', () => {
  it('gera header RIFF/WAVE correto para 16 kHz mono 16-bit', () => {
    const wav = encodeWavPcm16(new Int16Array([0, 1000, -1000]));
    expect(wav.length).toBe(44 + 6);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + 6);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM linear
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(28)).toBe(32_000); // byte rate
    expect(wav.readUInt16LE(34)).toBe(16); // bits/amostra
    expect(wav.readUInt32LE(40)).toBe(6); // bytes de dados
  });

  it('roundtrip das amostras', () => {
    const wav = encodeWavPcm16(new Int16Array([123, -456]));
    expect(wav.readInt16LE(44)).toBe(123);
    expect(wav.readInt16LE(46)).toBe(-456);
  });
});
