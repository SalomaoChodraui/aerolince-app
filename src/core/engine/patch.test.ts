import { describe, expect, it } from 'vitest';
import { applyPatches, parsePatches, patchedIds } from './patch.js';

const MASK = `TOMOGRAFIA COMPUTADORIZADA DO JOELHO [LADO]

Técnica:

Foram obtidas imagens por aquisição volumétrica.

Análise:

<!-- orgao: ossos -->
Estruturas ósseas de forma conservada, sem sinais de fraturas.

<!-- orgao: derrame -->
Não há sinais de derrame articular.

Conclusão:

<!-- impressao -->
Exame sem alterações significativas.`;

describe('parsePatches + applyPatches', () => {
  it('substitui blocos, insere novo bloco e troca o título', () => {
    const patch = `@@ titulo
TOMOGRAFIA COMPUTADORIZADA DO JOELHO DIREITO
@@ substituir: ossos
Fratura do platô tibial lateral, com afundamento de 4 mm.
@@ inserir-apos: ossos | id: espacos
Redução do espaço articular femorotibial medial.
@@ substituir: impressao
Fratura do platô tibial lateral.`;
    const ops = parsePatches(patch);
    const out = applyPatches(MASK, ops);
    expect(out).toContain('JOELHO DIREITO');
    expect(out).not.toContain('[LADO]');
    expect(out).toContain('Fratura do platô tibial lateral, com afundamento de 4 mm.');
    expect(out).not.toContain('Estruturas ósseas de forma conservada');
    expect(out).toContain('<!-- orgao: espacos -->\nRedução do espaço articular femorotibial medial.');
    expect(out.indexOf('Redução do espaço')).toBeGreaterThan(out.indexOf('Fratura do platô'));
    expect(out.indexOf('Redução do espaço')).toBeLessThan(out.indexOf('Não há sinais de derrame'));
    expect(out).toContain('Conclusão:\n\n<!-- impressao -->\nFratura do platô tibial lateral.');
    // bloco não tocado permanece byte-idêntico
    expect(out).toContain('Não há sinais de derrame articular.');
    expect(patchedIds(ops)).toEqual(['ossos', 'espacos', 'impressao', 'tecnica']);
  });

  it('sem-alteracoes devolve a máscara intacta', () => {
    const out = applyPatches(MASK, parsePatches('@@ sem-alteracoes'));
    expect(out).toBe(MASK);
  });

  it('patch de técnica substitui só o parágrafo da técnica', () => {
    const out = applyPatches(
      MASK,
      parsePatches('@@ tecnica\nImagens obtidas com a administração intravenosa de contraste iodado.'),
    );
    expect(out).toContain('Técnica:\n\nImagens obtidas com a administração intravenosa');
    expect(out).toContain('Análise:');
  });

  it('alvo inexistente lança PatchError', () => {
    expect(() => applyPatches(MASK, parsePatches('@@ substituir: figado\nqualquer'))).toThrow(
      /bloco não encontrado/,
    );
  });

  it('resposta sem patches lança PatchError', () => {
    expect(() => parsePatches('O laudo está normal.')).toThrow(/sem nenhum patch/);
  });
});
