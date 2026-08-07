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

  it('bloqueia a nota de processo do defeito de campo (linha literal)', () => {
    const v = validarLaudo(`${LAUDO_OK}\n(bloco removido — não é achado abdominal/pélvico)`);
    expect(v.erros.length).toBeGreaterThan(0);
    expect(v.erros.join(' ')).toMatch(/nota de processo/);
  });

  it('bloqueia vocabulário de sistema entre parênteses e frases de processo', () => {
    expect(validarLaudo(`${LAUDO_OK}\n(não se aplica a este exame)`).erros.length).toBeGreaterThan(0);
    expect(validarLaudo(`${LAUDO_OK}\n(placeholder da máscara)`).erros.length).toBeGreaterThan(0);
    expect(validarLaudo(`${LAUDO_OK}\nTrecho removido pelo sistema.`).erros.length).toBeGreaterThan(0);
  });

  it('NÃO bloqueia laudo com parênteses clínicos legítimos (falso positivo)', () => {
    const laudo = `TOMOGRAFIA COMPUTADORIZADA DE ABDOME E PELVE

Técnica:

Imagens volumétricas obtidas sem contraste intravenoso.

Análise:

Fígado com atenuação difusamente reduzida; nódulo hepático referido não identificado (não caracterizado).
Cisto renal simples à esquerda (Bosniak II), medindo 1,8 cm, estável (vide comparativo).
Divertículos no cólon sigmoide (sem sinais de complicação).
Discreta dilatação do colédoco (0,9 cm), habitual pós-colecistectomia.
Linfonodos mesentéricos de aspecto reacional (o maior com 0,8 cm no menor eixo).

Conclusão:

Achados acima descritos (sem sinais de complicação aguda).`;
    const v = validarLaudo(laudo);
    expect(v.erros).toEqual([]);
  });
});
