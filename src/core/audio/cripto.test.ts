import { describe, expect, it } from 'vitest';
import { cifrarSegmento, decifrarSegmento, gerarChaveSessao } from './cripto.js';

describe('cripto do spool', () => {
  it('roundtrip cifra→decifra', () => {
    const chave = gerarChaveSessao();
    const plano = Buffer.from('pcm de teste 1234567890');
    const cifrado = cifrarSegmento(chave, plano);
    expect(cifrado.length).toBe(12 + 16 + plano.length);
    expect(cifrado.subarray(28).equals(plano)).toBe(false); // nada em claro
    expect(decifrarSegmento(chave, cifrado).equals(plano)).toBe(true);
  });

  it('IVs diferentes a cada chamada', () => {
    const chave = gerarChaveSessao();
    const a = cifrarSegmento(chave, Buffer.from('x'));
    const b = cifrarSegmento(chave, Buffer.from('x'));
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
  });

  it('adulteração é detectada', () => {
    const chave = gerarChaveSessao();
    const cifrado = Buffer.concat([cifrarSegmento(chave, Buffer.from('conteudo'))]);
    const i = cifrado.length - 1;
    cifrado[i] = (cifrado[i]!) ^ 0xff;
    expect(() => decifrarSegmento(chave, cifrado)).toThrow();
  });

  it('chave errada é rejeitada', () => {
    const cifrado = cifrarSegmento(gerarChaveSessao(), Buffer.from('conteudo'));
    expect(() => decifrarSegmento(gerarChaveSessao(), cifrado)).toThrow();
  });
});
