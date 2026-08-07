import { describe, expect, it } from 'vitest';
import { PatchError, applyPatches, parsePatches, patchedIds } from './patch.js';

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

  it('inserir-antes cria bloco acima do alvo (achado que abre o laudo)', () => {
    const out = applyPatches(
      MASK,
      parsePatches('@@ inserir-antes: ossos | id: coluna\nEspondilose torácica.'),
    );
    expect(out.indexOf('Espondilose torácica.')).toBeLessThan(out.indexOf('Estruturas ósseas'));
    expect(out).toContain('<!-- orgao: coluna -->\nEspondilose torácica.');
  });

  it('tolera "@@ substituir: tecnica" e "@@ substituir: titulo" (alvo especial)', () => {
    const out = applyPatches(
      MASK,
      parsePatches('@@ substituir: tecnica\nImagens com artefato de movimento.'),
    );
    expect(out).toContain('Técnica:\n\nImagens com artefato de movimento.');
    expect(out).toContain('Análise:');
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

const MASK_OPINIAO = `TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO

Técnica:

Foram obtidas imagens por aquisição volumétrica.

Análise:

<!-- orgao: parenquima -->
Parênquima encefálico com morfologia, atenuação e distribuição normais.

Opinião:

<!-- impressao -->
Exame sem alterações significativas.`;

describe('achado-adicional (achado fora da região do exame)', () => {
  const SECAO = '<!-- orgao: achados-adicionais -->\nAchados adicionais:\nDerrame pleural à direita.';

  it('cria a seção imediatamente antes de "Conclusão:"', () => {
    const out = applyPatches(MASK, parsePatches('@@ achado-adicional\nDerrame pleural à direita.'));
    expect(out).toContain(`${SECAO}\n\nConclusão:`);
    expect(out.indexOf('Achados adicionais:')).toBeGreaterThan(
      out.indexOf('Não há sinais de derrame articular.'),
    );
  });

  it('cria a seção imediatamente antes de "Opinião:" (crânio)', () => {
    const out = applyPatches(
      MASK_OPINIAO,
      parsePatches('@@ achado-adicional\nDerrame pleural à direita.'),
    );
    expect(out).toContain(`${SECAO}\n\nOpinião:`);
  });

  it('segundo achado adicional na mesma resposta NÃO duplica o rótulo', () => {
    const out = applyPatches(
      MASK,
      parsePatches(
        '@@ achado-adicional\nDerrame pleural à direita.\n@@ achado-adicional\nNódulo pulmonar basal direito.',
      ),
    );
    expect(out.match(/Achados adicionais:/g)).toHaveLength(1);
    expect(out).toContain(
      'Achados adicionais:\nDerrame pleural à direita.\nNódulo pulmonar basal direito.\n\nConclusão:',
    );
  });

  it('refino sobre laudo que já tem a seção acrescenta a frase sem duplicar o rótulo', () => {
    const laudo1 = applyPatches(MASK, parsePatches('@@ achado-adicional\nDerrame pleural à direita.'));
    const laudo2 = applyPatches(laudo1, parsePatches('@@ achado-adicional\nAteromatose aórtica.'));
    expect(laudo2.match(/Achados adicionais:/g)).toHaveLength(1);
    expect(laudo2).toContain(
      'Achados adicionais:\nDerrame pleural à direita.\nAteromatose aórtica.\n\nConclusão:',
    );
  });

  it('máscara sem linha de conclusão (degenerado): acrescenta ao final do corpo', () => {
    const semConclusao = `Análise:\n\n<!-- orgao: ossos -->\nEstruturas ósseas normais.`;
    const out = applyPatches(
      semConclusao,
      parsePatches('@@ achado-adicional\nDerrame pleural à direita.'),
    );
    expect(out.endsWith(SECAO)).toBe(true);
  });

  it('texto não patcheado continua byte-idêntico à máscara', () => {
    const out = applyPatches(MASK, parsePatches('@@ achado-adicional\nDerrame pleural à direita.'));
    expect(out.replace(`${SECAO}\n\n`, '')).toBe(MASK);
  });

  it('entra em patchedIds como "achados-adicionais", sem duplicar', () => {
    const ops = parsePatches(
      '@@ achado-adicional\nDerrame pleural à direita.\n@@ achado-adicional\nAteromatose aórtica.',
    );
    expect(patchedIds(ops)).toEqual(['achados-adicionais']);
  });

  it('achado-adicional sem texto lança PatchError', () => {
    expect(() => parsePatches('@@ achado-adicional\n')).toThrow(PatchError);
  });
});

describe('remover (bloco inteiro, sem buraco de formatação)', () => {
  it('remove marcador, texto e a linha em branco separadora', () => {
    const out = applyPatches(MASK, parsePatches('@@ remover: derrame'));
    expect(out).not.toContain('derrame articular');
    expect(out).not.toContain('<!-- orgao: derrame -->');
    expect(out).not.toContain('\n\n\n');
    expect(out).toContain(
      'Estruturas ósseas de forma conservada, sem sinais de fraturas.\n\nConclusão:',
    );
  });

  it('remove o último bloco sem deixar linhas em branco penduradas', () => {
    const out = applyPatches(MASK, parsePatches('@@ remover: impressao'));
    expect(out.endsWith('Conclusão:')).toBe(true);
  });

  it('bloco inexistente lança PatchError', () => {
    expect(() => applyPatches(MASK, parsePatches('@@ remover: figado'))).toThrow(
      /bloco não encontrado/,
    );
  });

  it('remover sem id lança PatchError', () => {
    expect(() => parsePatches('@@ remover:')).toThrow(PatchError);
  });

  it('entra em patchedIds com o id removido', () => {
    const ops = parsePatches('@@ remover: derrame\n@@ substituir: impressao\nSem derrame articular.');
    expect(patchedIds(ops)).toEqual(['derrame', 'impressao']);
  });
});

describe('normalização de ids (P0-04)', () => {
  it('normaliza novoId acentuado para ascii kebab-case', () => {
    const ops = parsePatches('@@ inserir-apos: figado | id: vesícula-biliar\nVesícula com cálculo.');
    expect(ops[0]!.novoId).toBe('vesicula-biliar');
  });

  it('normaliza alvo acentuado para casar bloco ascii da máscara', () => {
    const ops = parsePatches('@@ substituir: fígado\nFígado com esteatose.');
    expect(ops[0]!.alvo).toBe('figado');
  });

  it('rejeita substituição com texto vazio', () => {
    expect(() => parsePatches('@@ substituir: rins\n')).toThrow(PatchError);
  });

  it('rejeita inserção com texto vazio', () => {
    expect(() => parsePatches('@@ inserir-apos: rins | id: novo\n')).toThrow(PatchError);
  });
});
