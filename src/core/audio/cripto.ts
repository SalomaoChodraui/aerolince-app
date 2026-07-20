import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function gerarChaveSessao(): Buffer {
  return randomBytes(32);
}

// Formato no disco: [iv(12)][tag(16)][dados cifrados]
export function cifrarSegmento(chave: Buffer, plano: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, chave, iv);
  const dados = Buffer.concat([cipher.update(plano), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), dados]);
}

export function decifrarSegmento(chave: Buffer, cifrado: Buffer): Buffer {
  const iv = cifrado.subarray(0, IV_BYTES);
  const tag = cifrado.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const dados = cifrado.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALG, chave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(dados), decipher.final()]);
}
