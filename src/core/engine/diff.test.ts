import { describe, expect, it } from 'vitest';
import { diffAgainstMask, parseOrganBlocks, stripMarkers } from './diff.js';

const MASK = `## Técnica

Imagens volumétricas.

## Análise

<!-- orgao: figado -->
Fígado com dimensões normais.

<!-- orgao: rins -->
Rins tópicos, de dimensões e contornos habituais.

## Conclusão

<!-- impressao -->
Estudo dentro dos limites da normalidade.`;

describe('parseOrganBlocks', () => {
  it('extrai blocos de órgão e impressão', () => {
    const blocks = parseOrganBlocks(MASK);
    expect(blocks.map((b) => b.id)).toEqual(['figado', 'rins', 'impressao']);
    expect(blocks[1]!.text).toBe('Rins tópicos, de dimensões e contornos habituais.');
  });
});

describe('diffAgainstMask', () => {
  it('detecta bloco substituído e blocos preservados', () => {
    const report = MASK.replace(
      'Rins tópicos, de dimensões e contornos habituais.',
      'Cálculo de 1,0 cm no rim direito, com densidade de 500 UH.',
    ).replace('Estudo dentro dos limites da normalidade.', 'Nefrolitíase à direita.');
    const diff = diffAgainstMask(MASK, report);
    expect(diff.changed).toEqual(['rins', 'impressao']);
    expect(diff.kept).toEqual(['figado']);
  });

  it('laudo idêntico à máscara não tem blocos alterados', () => {
    const diff = diffAgainstMask(MASK, MASK);
    expect(diff.changed).toHaveLength(0);
  });
});

describe('stripMarkers', () => {
  it('remove todos os marcadores e não deixa linhas triplas em branco', () => {
    const out = stripMarkers(MASK);
    expect(out).not.toContain('<!--');
    expect(out).toContain('Fígado com dimensões normais.');
    expect(out).not.toMatch(/\n{3,}/);
  });

  it('remove marcador com id acentuado (vazamento real da auditoria)', () => {
    const texto = 'Fígado normal.\n<!-- orgao: vesícula-biliar -->\nVesícula sem cálculos.';
    const limpo = stripMarkers(texto);
    expect(limpo).not.toContain('<!--');
    expect(limpo).toContain('Vesícula sem cálculos.');
  });
});
