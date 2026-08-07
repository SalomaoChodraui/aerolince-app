import { describe, expect, it } from 'vitest';
import {
  LaudoConfig,
  PrefsLaudo,
  SECOES_PADRAO,
  formatarLaudo,
  prefsDoExame,
} from './formatar.js';

/** Prefs de fábrica (cópia mutável para os testes customizarem). */
const padrao = (): PrefsLaudo => ({
  paragrafo: 'por-bloco',
  secoes: SECOES_PADRAO.map((s) => ({ ...s })),
});

/** Prefs padrão com ajustes pontuais por id. */
function prefs(
  paragrafo: 'por-bloco' | 'corrido',
  ajustes: Record<string, { rotulo?: string; ativa?: boolean }> = {},
): PrefsLaudo {
  const p = padrao();
  p.paragrafo = paragrafo;
  p.secoes = p.secoes.map((s) => (ajustes[s.id] ? { ...s, ...ajustes[s.id] } : s));
  return p;
}

/** Laudo real de abdome (fixture sintética, pós-stripMarkers — como sai hoje). */
const ABDOME = `TOMOGRAFIA COMPUTADORIZADA DE ABDOME E PELVE

Técnica:

Realizado estudo helicoidal do abdome e da pelve, sem injeção intravenosa do meio de contraste iodado, com reconstruções multiplanares.

Análise:

Fígado de dimensões normais, contornos regulares e coeficiente de atenuação preservado.

Vesícula biliar com cálculo de 1,2 cm, de paredes finas.

Rins em topografia habitual, com dimensões, contornos e espessura parenquimatosa preservados.

Divertículos no cólon direito, com espessamento parietal e densificação da gordura adjacente, sem sinais de complicação.
Pequena quantidade de líquido livre adjacente.

Achados adicionais:
Derrame pleural à direita.

Conclusão:

Diverticulite do cólon direito, não complicada.
Colelitíase.`;

const CRANIO = `TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO

Técnica:

Estudo realizado em tomógrafo de múltiplos detectores, sem uso intravenoso do meio de contraste iodado.

Análise:

Parênquima encefálico com coeficientes de atenuação preservados, sem lesões focais.

Estruturas da linha média centradas.

Opinião:

Estudo tomográfico do crânio dentro dos limites da normalidade.`;

describe('formatarLaudo — invariância (protege quem não optou)', () => {
  it('prefs padrão + por-bloco devolvem texto BYTE-IDÊNTICO (abdome)', () => {
    expect(formatarLaudo(ABDOME, padrao())).toBe(ABDOME);
  });

  it('prefs padrão preservam "Opinião:" do crânio (não vira "Conclusão:")', () => {
    expect(formatarLaudo(CRANIO, padrao())).toBe(CRANIO);
  });

  it('prefs padrão NÃO omitem "Nota:"/"Indicação:" pré-existentes no texto (passthrough de fábrica)', () => {
    const comNota = `${CRANIO}\n\nNota:\nControle evolutivo em 6 meses.`;
    expect(formatarLaudo(comNota, padrao())).toBe(comNota);
  });

  it('por-bloco customizado mas sem nada a mudar no texto também é idêntico', () => {
    // observacao ativa (≠ fábrica), mas o texto não tem observação: nada muda
    expect(formatarLaudo(ABDOME, prefs('por-bloco', { observacao: { ativa: true } }))).toBe(ABDOME);
  });
});

describe('formatarLaudo — modo corrido', () => {
  it('junta as frases da Análise com \\n e mantém \\n\\n entre seções', () => {
    const out = formatarLaudo(ABDOME, prefs('corrido'));
    expect(out).toContain(
      'Análise:\nFígado de dimensões normais, contornos regulares e coeficiente de atenuação preservado.\nVesícula biliar com cálculo de 1,2 cm, de paredes finas.\nRins em topografia habitual, com dimensões, contornos e espessura parenquimatosa preservados.\nDivertículos no cólon direito, com espessamento parietal e densificação da gordura adjacente, sem sinais de complicação.\nPequena quantidade de líquido livre adjacente.',
    );
    expect(out).toContain('multiplanares.\n\nAnálise:');
    expect(out).toContain('TOMOGRAFIA COMPUTADORIZADA DE ABDOME E PELVE\n\nTécnica:\nRealizado estudo helicoidal');
    expect(out).toContain('adjacente.\n\nAchados adicionais:\nDerrame pleural à direita.\n\nConclusão:\nDiverticulite do cólon direito, não complicada.\nColelitíase.');
    expect(out).not.toMatch(/\n{3,}/);
  });

  it('nenhuma frase se perde entre os dois modos', () => {
    const frases = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean).sort();
    expect(frases(formatarLaudo(ABDOME, prefs('corrido')))).toEqual(frases(ABDOME));
  });
});

describe('formatarLaudo — seções ativas/inativas e rótulos', () => {
  it('rótulo renomeado aparece na saída', () => {
    const out = formatarLaudo(ABDOME, prefs('por-bloco', { conclusao: { rotulo: 'Impressão diagnóstica:' } }));
    expect(out).toContain('Impressão diagnóstica:\n\nDiverticulite do cólon direito');
    expect(out).not.toContain('Conclusão:');
  });

  it('rótulo padrão NÃO sobrescreve variante do médico já no texto (Opinião: fica)', () => {
    // conclusao com rótulo de fábrica ("Conclusão:") e remontagem forçada pelo
    // modo corrido: mesmo assim "Opinião:" é preservada
    const out = formatarLaudo(CRANIO, prefs('corrido'));
    expect(out).toContain('Opinião:\nEstudo tomográfico do crânio dentro dos limites da normalidade.');
    expect(out).not.toContain('Conclusão:');
  });
});

describe('formatarLaudo — seção desligada NUNCA apaga conteúdo (ativa = "não ofereça/crie")', () => {
  it('caso do coordenador: crânio com Nota + corrido + observacao desligada (default) → a Nota APARECE', () => {
    const comNota = `${CRANIO}\n\nNota: Comparado com exame prévio.`;
    const out = formatarLaudo(comNota, prefs('corrido')); // observacao nasce ativa:false
    expect(out).toContain('Nota: Comparado com exame prévio.');
    expect(out).toContain('Opinião:\nEstudo tomográfico do crânio dentro dos limites da normalidade.');
    expect(out).not.toContain('Conclusão:');
    expect(out).not.toContain('Observação:');
  });

  it('seção desligada E vazia continua omitida (o switch evita rótulo órfão)', () => {
    const t = `TITULO\n\nAnálise:\n\nFígado normal.\n\nObservação:`;
    const out = formatarLaudo(t, prefs('corrido')); // observacao inativa por padrão
    expect(out).toBe('TITULO\n\nAnálise:\nFígado normal.');
  });

  it('tecnica desligada COM técnica preenchida: aparece mesmo assim (nos dois modos)', () => {
    expect(formatarLaudo(ABDOME, prefs('por-bloco', { tecnica: { ativa: false } }))).toBe(ABDOME);
    const corrido = formatarLaudo(ABDOME, prefs('corrido', { tecnica: { ativa: false } }));
    expect(corrido).toContain('Técnica:\nRealizado estudo helicoidal do abdome e da pelve');
  });

  it('título desligado mas preenchido também não some', () => {
    const out = formatarLaudo(ABDOME, prefs('corrido', { titulo: { ativa: false } }));
    expect(out.startsWith('TOMOGRAFIA COMPUTADORIZADA DE ABDOME E PELVE')).toBe(true);
  });

  it('indicação ditada com a seção desligada aparece na saída (nada ditado some)', () => {
    const t = `TITULO\n\nTécnica:\n\nEstudo helicoidal.\n\nIndicação:\nDor abdominal há 3 dias.\n\nAnálise:\n\nFígado normal.\n\nConclusão:\n\nNormal.`;
    const out = formatarLaudo(t, prefs('corrido')); // indicacao nasce ativa:false
    expect(out).toContain('Indicação:\nDor abdominal há 3 dias.');
  });
});

describe('formatarLaudo — crânio com porExame (Opinião:/Nota:)', () => {
  const config: { laudo: LaudoConfig } = {
    laudo: {
      paragrafo: 'corrido',
      secoes: SECOES_PADRAO.map((s) =>
        s.id === 'conclusao'
          ? { ...s, rotulo: 'Impressão:' } // global renomeado
          : s.id === 'observacao'
            ? { ...s, ativa: true }
            : { ...s },
      ),
      porExame: {
        'tc-cranio': {
          secoes: [
            { id: 'conclusao', rotulo: 'Opinião:' },
            { id: 'observacao', rotulo: 'Nota:' },
          ],
        },
      },
    },
  };

  it('prefsDoExame mescla global com o override do exame', () => {
    const p = prefsDoExame(config, 'tc-cranio');
    expect(p.paragrafo).toBe('corrido');
    expect(p.secoes.find((s) => s.id === 'conclusao')!.rotulo).toBe('Opinião:');
    expect(p.secoes.find((s) => s.id === 'observacao')).toEqual({ id: 'observacao', rotulo: 'Nota:', ativa: true });
    // exame sem override usa o global
    expect(prefsDoExame(config, 'tc-abdome-total').secoes.find((s) => s.id === 'conclusao')!.rotulo).toBe('Impressão:');
  });

  it('crânio sai com "Opinião:" e "Nota:"; abdome sai com o global "Impressão:"', () => {
    const comNota = `${CRANIO}\n\nObservação:\nControle evolutivo em 6 meses.`;
    const cranio = formatarLaudo(comNota, prefsDoExame(config, 'tc-cranio'));
    expect(cranio).toContain('Opinião:\nEstudo tomográfico do crânio dentro dos limites da normalidade.');
    expect(cranio).toContain('Nota:\nControle evolutivo em 6 meses.');
    const abdome = formatarLaudo(ABDOME, prefsDoExame(config, 'tc-abdome-total'));
    expect(abdome).toContain('Impressão:\nDiverticulite do cólon direito, não complicada.');
  });
});

describe('formatarLaudo — robustez (texto vem de LLM; nada pode sumir)', () => {
  it('texto sem nenhum rótulo sai intacto (nos dois modos)', () => {
    const t = 'Linha solta um.\n\nLinha solta dois.\nLinha solta três.';
    expect(formatarLaudo(t, prefs('por-bloco', { tecnica: { ativa: false } }))).toBe(t);
    expect(formatarLaudo(t, prefs('corrido'))).toBe(t);
  });

  it('rótulo desconhecido não perde conteúdo (fica na seção corrente)', () => {
    const t = `TITULO\n\nAnálise:\n\nFígado normal.\n\nMedidas adicionais:\nBaço de 11 cm.\n\nConclusão:\n\nNormal.`;
    const out = formatarLaudo(t, prefs('corrido'));
    expect(out).toContain('Análise:\nFígado normal.\nMedidas adicionais:\nBaço de 11 cm.');
    expect(out).toContain('Conclusão:\nNormal.');
  });

  it('seção vazia não emite rótulo órfão', () => {
    const t = `TITULO\n\nAnálise:\n\nFígado normal.\n\nConclusão:`;
    const out = formatarLaudo(t, prefs('corrido'));
    expect(out).toBe('TITULO\n\nAnálise:\nFígado normal.');
  });

  it('conteúdo na MESMA linha do rótulo não se perde', () => {
    const t = `TITULO\n\nConclusão: Exame normal.`;
    expect(formatarLaudo(t, prefs('corrido'))).toBe('TITULO\n\nConclusão: Exame normal.');
    const renome = formatarLaudo(t, prefs('por-bloco', { conclusao: { rotulo: 'Opinião:' } }));
    expect(renome).toContain('Opinião: Exame normal.');
  });

  it('todas as seções desligadas mas com conteúdo: NADA some (devolve o texto)', () => {
    const ajustes = Object.fromEntries(SECOES_PADRAO.map((s) => [s.id, { ativa: false }]));
    expect(formatarLaudo(ABDOME, prefs('por-bloco', ajustes))).toBe(ABDOME);
  });

  it('entrada vazia ou espaços sai intacta', () => {
    expect(formatarLaudo('', prefs('corrido'))).toBe('');
    expect(formatarLaudo('  \n ', prefs('corrido'))).toBe('  \n ');
  });

  it('nunca lança: prefs malformadas devolvem o texto de entrada', () => {
    const quebrado = { paragrafo: 'corrido', secoes: null } as unknown as PrefsLaudo;
    expect(formatarLaudo(ABDOME, quebrado)).toBe(ABDOME);
  });
});

describe('formatarLaudo — laudo de abdome nos dois modos (amostra do report)', () => {
  it('por-bloco (padrão) = entrada; corrido tem uma frase por linha na Análise', () => {
    expect(formatarLaudo(ABDOME, padrao())).toBe(ABDOME);
    const corrido = formatarLaudo(ABDOME, prefs('corrido'));
    const analise = corrido.slice(corrido.indexOf('Análise:'), corrido.indexOf('Achados adicionais:'));
    expect(analise.trim().split('\n\n')).toHaveLength(1); // sem parágrafos internos
  });
});
