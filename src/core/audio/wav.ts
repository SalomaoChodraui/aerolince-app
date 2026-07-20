import { SAMPLE_RATE } from './pcm.js';

// WAV PCM16 mono little-endian (assume plataforma LE — x86/ARM).
export function encodeWavPcm16(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM linear
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate = rate * canais * 2
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  new Uint8Array(buf.buffer, buf.byteOffset + 44, dataBytes).set(
    new Uint8Array(pcm.buffer, pcm.byteOffset, dataBytes),
  );
  return buf;
}
