import { describe, expect, it } from 'vitest';
import { Mask } from './schema.js';
import { matchLocal, rankMasks, resolverContraste } from './matcher.js';

function mk(id: string, nome: string, sinonimos: string[] = [], contraste: 'sem' | 'com' | 'opcional' = 'sem'): Mask {
  return {
    id,
    modalidade: 'TC',
    regiao: [],
    nome,
    sinonimos,
    contraste,
    versao: 1,
    origem: 'manual',
    prefixos: [],
    body: '',
    filePath: `${id}.md`,
  };
}

const MASKS: Mask[] = [
  mk('tc-abdome-total', 'TC de abdome total', ['abdome', 'abdômen']),
  mk('tc-abdome-total-com-contraste', 'TC de abdome total com contraste', ['abdome', 'abdômen'], 'com'),
  mk('tc-torax', 'TC de tórax', ['tórax', 'pulmão']),
  mk('tc-cranio', 'TC de crânio', ['crânio', 'cabeça']),
];

describe('matchLocal', () => {
  it('decide quando uma única família casa', () => {
    expect(matchLocal('tomografia de tórax com nódulo', MASKS)?.id).toBe('tc-torax');
  });
  it('devolve null em ambiguidade (duas famílias)', () => {
    expect(matchLocal('abdome e tórax', MASKS)).toBeNull();
  });
});

describe('resolverContraste', () => {
  it('sem citar contraste → variante sem contraste', () => {
    const m = resolverContraste(MASKS[1]!, 'tomo de abdome com diverticulite', MASKS);
    expect(m.id).toBe('tc-abdome-total');
  });
  it('citando contraste → variante com contraste', () => {
    const m = resolverContraste(MASKS[0]!, 'abdome com contraste, diverticulite', MASKS);
    expect(m.id).toBe('tc-abdome-total-com-contraste');
  });
});

describe('rankMasks', () => {
  it('ranqueia a família certa em primeiro', () => {
    const r = rankMasks('essa tomo de abdome mostra diverticulite', MASKS);
    expect(r[0]!.id).toBe('tc-abdome-total');
  });
  it('resolve a variante de contraste do candidato', () => {
    const r = rankMasks('abdome com contraste, diverticulite', MASKS);
    expect(r[0]!.id).toBe('tc-abdome-total-com-contraste');
  });
  it('exclui score zero e respeita topN', () => {
    const r = rankMasks('tomografia de crânio', MASKS, 2);
    expect(r.map((m) => m.id)).toEqual(['tc-cranio']); // tórax/abdome têm score zero
  });
  it('uma máscara por família', () => {
    const r = rankMasks('abdome', MASKS, 4);
    expect(r.filter((m) => m.id.startsWith('tc-abdome')).length).toBe(1);
  });
});
