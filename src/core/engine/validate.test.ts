import { describe, expect, it } from 'vitest';
import { validarLaudo } from './validate.js';

const LAUDO_OK = `TOMOGRAFIA COMPUTADORIZADA DO ABDOME TOTAL

Técnica:

Exame realizado em aparelho multislice, sem contraste endovenoso.

Fígado de dimensões normais, contornos regulares e densidade preservada.

Vesícula biliar normodistendida, sem cálculos radiopacos.

Impressão:

Exame dentro dos padrões da normalidade.`;

describe('validarLaudo', () => {
  it('aprova laudo limpo', () => {
    const v = validarLaudo(LAUDO_OK);
    expect(v.erros).toEqual([]);
    expect(v.avisos).toEqual([]);
  });

  it('bloqueia marcador de bloco vazado (caso real da auditoria)', () => {
    const v = validarLaudo(`${LAUDO_OK}\n<!-- orgao: vesícula-biliar -->`);
    expect(v.erros.length).toBeGreaterThan(0);
  });

  it('bloqueia cabeçalho de patch vazado', () => {
    const v = validarLaudo(`${LAUDO_OK}\n@@ substituir: rins`);
    expect(v.erros.length).toBeGreaterThan(0);
  });

  it('bloqueia laudo suspeitamente curto (truncamento)', () => {
    expect(validarLaudo('Fígado normal.').erros.length).toBeGreaterThan(0);
  });

  it('avisa (sem bloquear) placeholder de anonimização', () => {
    const v = validarLaudo(`${LAUDO_OK}\nComparado ao exame de [NOME].`);
    expect(v.erros).toEqual([]);
    expect(v.avisos.length).toBe(1);
  });
});
