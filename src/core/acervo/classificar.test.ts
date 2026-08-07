import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { agruparClusters, classificarDocumento, sugerirMaskId } from './classificar.js';

describe('classificarDocumento', () => {
  it('tc de crânio (acentuado), sem menção a contraste → sem contraste por padrão', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE CRÂNIO\n\nTécnica:\n\nCortes axiais sem alterações.';
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'tc',
      exame: 'cranio',
      contraste: 'sem',
      lateral: false,
    });
  });

  it('tc de encéfalo (sinônimo de crânio) minúsculo, sem acento → mesmo slug "cranio"', () => {
    const texto = 'tomografia computadorizada do encefalo\n\nsem alteracoes.';
    const c = classificarDocumento(texto);
    expect(c.modalidade).toBe('tc');
    expect(c.exame).toBe('cranio');
  });

  it('tc de abdome total COM contraste (frase "administração intravenosa")', () => {
    const texto = [
      'TOMOGRAFIA COMPUTADORIZADA DE ABDOME TOTAL',
      '',
      'Técnica:',
      'Realizado estudo com a administração intravenosa do meio de contraste iodado.',
    ].join('\n');
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'tc',
      exame: 'abdome-total',
      contraste: 'com',
      lateral: false,
    });
  });

  it('tc de abdome e pelve SEM contraste (negação explícita "sem a administração")', () => {
    const texto = [
      'TOMOGRAFIA COMPUTADORIZADA DE ABDOME E PELVE',
      '',
      'Técnica:',
      'Realizado estudo sem a administração intravenosa do meio de contraste iodado.',
    ].join('\n');
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'tc',
      exame: 'abdome-total',
      contraste: 'sem',
      lateral: false,
    });
  });

  it('negação de contraste NÃO deve ser confundida com afirmação (a frase "administração intravenosa" está DENTRO da negativa)', () => {
    // Regressão do cuidado do brief: "com a administração intravenosa" é a afirmativa;
    // "sem a administração intravenosa" é a negativa — e contém a mesma sub-frase.
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE CRÂNIO\n\nSem a administração intravenosa do meio de contraste.';
    expect(classificarDocumento(texto).contraste).toBe('sem');
  });

  it('outra forma de negação: "não foi administrado" → sem contraste', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE TÓRAX\n\nNão foi administrado contraste iodado por via endovenosa.';
    expect(classificarDocumento(texto).contraste).toBe('sem');
  });

  // Fraseado real da Técnica na biblioteca-base usa "injeção intravenosa/endovenosa"
  // (não "administração") — sem estas variantes, laudos reais COM contraste cairiam
  // no default 'sem'. Ver biblioteca-base/tc-abdome-total-com-contraste.md e tc-abdome-total.md.
  it('"com a injeção endovenosa do meio de contraste iodado" → com contraste', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE CRÂNIO\n\nRealizado com a injeção endovenosa do meio de contraste iodado.';
    expect(classificarDocumento(texto).contraste).toBe('com');
  });

  it('"sem a injeção endovenosa do meio de contraste iodado" → sem contraste (negação, mesmo contendo a sub-frase afirmativa)', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE CRÂNIO\n\nRealizado sem a injeção endovenosa do meio de contraste iodado.';
    expect(classificarDocumento(texto).contraste).toBe('sem');
  });

  it('"após injeção intravenosa de contraste" → com contraste', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE ABDOME TOTAL\n\nRealizado após injeção intravenosa de contraste.';
    expect(classificarDocumento(texto).contraste).toBe('com');
  });

  it('fraseado real de tc-abdome-total-com-contraste.md ("após injeção intravenosa do meio de contraste iodado") → com', () => {
    const texto =
      'TOMOGRAFIA COMPUTADORIZADA DE ABDOME E PELVE\n\nRealizado estudo helicoidal do abdome e da pelve após injeção intravenosa do meio de contraste iodado, com reconstruções multiplanares.';
    expect(classificarDocumento(texto).contraste).toBe('com');
  });

  it('fraseado real de tc-abdome-total.md ("sem injeção intravenosa do meio de contraste iodado") → sem', () => {
    const texto =
      'TOMOGRAFIA COMPUTADORIZADA DE ABDOME E PELVE\n\nRealizado estudo helicoidal do abdome e da pelve, sem injeção intravenosa do meio de contraste iodado, com reconstruções multiplanares.';
    expect(classificarDocumento(texto).contraste).toBe('sem');
  });

  // Segunda variante real de Técnica na biblioteca-base: tc-cranio.md é a ÚNICA das 18
  // máscaras que não diz "injeção" — diz "uso intravenoso" (ver linha abaixo, fraseado
  // exato do arquivo real).
  it('"após uso intravenoso do meio de contraste" → com contraste', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE ABDOME TOTAL\n\nRealizado após uso intravenoso do meio de contraste.';
    expect(classificarDocumento(texto).contraste).toBe('com');
  });

  it('fraseado real de tc-cranio.md ("sem uso intravenoso do meio de contraste iodado") → sem', () => {
    const texto =
      'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nEstudo realizado em tomógrafo de múltiplos detectores, com cortes volumétricos, sem uso intravenoso do meio de contraste iodado.';
    expect(classificarDocumento(texto).contraste).toBe('sem');
  });

  it('"sem o uso endovenoso do meio de contraste" → sem contraste (variante "endovenoso" + negação com artigo "o")', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nRealizado sem o uso endovenoso do meio de contraste.';
    expect(classificarDocumento(texto).contraste).toBe('sem');
  });

  it('rm de coluna lombar', () => {
    const texto = 'RESSONÂNCIA MAGNÉTICA DA COLUNA LOMBAR\n\nAlinhamento preservado.';
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'rm',
      exame: 'coluna-lombar',
      contraste: 'sem',
      lateral: false,
    });
  });

  it('rm "lombo-sacra" (sinônimo) também mapeia para coluna-lombar', () => {
    const texto = 'RESSONANCIA MAGNETICA DA COLUNA LOMBO-SACRA';
    expect(classificarDocumento(texto).exame).toBe('coluna-lombar');
  });

  it('rm sem "magnética" (só "RESSONANCIA", sem acento) ainda reconhece a modalidade', () => {
    const texto = 'RESSONANCIA DO ENCEFALO';
    expect(classificarDocumento(texto)).toMatchObject({ modalidade: 'rm', exame: 'cranio' });
  });

  it('us (ultrassonografia) de abdome', () => {
    const texto = 'ULTRASSONOGRAFIA DE ABDOME\n\nFígado de dimensões normais.';
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'us',
      exame: 'abdome-total',
      contraste: 'sem',
      lateral: false,
    });
  });

  it('us grafado "ULTRA-SONOGRAFIA" (hifenizado) também reconhece a modalidade', () => {
    const texto = 'ULTRA-SONOGRAFIA DE ABDOME';
    expect(classificarDocumento(texto).modalidade).toBe('us');
  });

  it('rx (radiografia) de tórax', () => {
    const texto = 'RADIOGRAFIA DE TÓRAX\n\nSem consolidações.';
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'rx',
      exame: 'torax',
      contraste: 'sem',
      lateral: false,
    });
  });

  it('rx grafado "RAIO-X" também reconhece a modalidade', () => {
    const texto = 'RAIO-X DE TÓRAX';
    expect(classificarDocumento(texto).modalidade).toBe('rx');
  });

  it('mg (mamografia) com lateralidade "bilateral" após o conector', () => {
    const texto = 'MAMOGRAFIA DAS MAMAS BILATERAL';
    const c = classificarDocumento(texto);
    expect(c.modalidade).toBe('mg');
    expect(c.lateral).toBe(true);
  });

  it('tc de joelho ESQUERDO → lateral true, exame sem sufixo de lado', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO JOELHO ESQUERDO';
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'tc',
      exame: 'joelho',
      contraste: 'sem',
      lateral: true,
    });
  });

  it('tc de joelho DIREITO → mesmo exame "joelho", lateral true', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO JOELHO DIREITO';
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'tc',
      exame: 'joelho',
      contraste: 'sem',
      lateral: true,
    });
  });

  it('título irreconhecível → modalidade desconhecida, exame null', () => {
    const texto = 'LAUDO MÉDICO — ANEXO ADMINISTRATIVO\n\nSem nenhum título de exame reconhecível.';
    expect(classificarDocumento(texto)).toEqual({
      modalidade: 'desconhecida',
      exame: null,
      contraste: 'sem',
      lateral: false,
    });
  });

  it('acentos variados: título totalmente em minúsculas e sem nenhum acento ainda classifica corretamente', () => {
    const texto = 'tomografia computadorizada de torax';
    expect(classificarDocumento(texto)).toMatchObject({ modalidade: 'tc', exame: 'torax' });
  });

  it('tc das sacroilíacas → slug "sacro-iliacas" (compatível com o id real tc-sacro-iliacas, não "sacroiliacas")', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DAS SACROILÍACAS';
    expect(classificarDocumento(texto).exame).toBe('sacro-iliacas');
  });

  // Regressão do bug de colisão (review): "tornozelo" aparece ANTES de "pe" na frase,
  // mas o id real da combinação é tc-pe (sinônimo oficial em tc-pe.md: "TC do tornozelo
  // e pé"), NÃO tc-tornozelo. Um match posicional (primeira palavra que casa) erraria aqui.
  it('"TORNOZELO E PÉ" → exame "pe" (id real tc-pe), NÃO "tornozelo" — a combinação vence sobre a palavra isolada que aparece primeiro', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO TORNOZELO E PÉ';
    expect(classificarDocumento(texto).exame).toBe('pe');
  });

  it('"PÉ E TORNOZELO" (ordem invertida) também → "pe" — o teste da combinação é independente de ordem', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO PÉ E TORNOZELO';
    expect(classificarDocumento(texto).exame).toBe('pe');
  });

  it('"TORNOZELO" isolado (sem "pé") continua mapeando para "tornozelo" — sem regressão', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO TORNOZELO';
    expect(classificarDocumento(texto).exame).toBe('tornozelo');
  });

  it('"PÉ" isolado (sem "tornozelo") continua mapeando para "pe" — sem regressão', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO PÉ';
    expect(classificarDocumento(texto).exame).toBe('pe');
  });

  it('"SEIOS PARANASAIS" (sinônimo novo) → "seios-da-face" (id real tc-seios-da-face)', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DOS SEIOS PARANASAIS';
    expect(classificarDocumento(texto).exame).toBe('seios-da-face');
  });

  // Caso do review: estudo MULTIFÁSICO cita uma fase SEM contraste e, na MESMA Técnica,
  // outra fase COM contraste (após a injeção). Um short-circuit global no "sem" isolado
  // classificaria isso errado como 'sem'; a neutralização seletiva resolve.
  it('multifásico ("sem contraste" seguido de fases arterial/portal após a injeção) → com contraste', () => {
    const texto =
      'TOMOGRAFIA COMPUTADORIZADA DE ABDOME TOTAL\n\nRealizados cortes axiais sem contraste, seguidos de cortes nas fases arterial e portal, após a injeção intravenosa do meio de contraste iodado.';
    expect(classificarDocumento(texto).contraste).toBe('com');
  });

  it('não regride: "sem a injeção endovenosa do meio de contraste iodado" continua "sem" com a neutralização', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE CRÂNIO\n\nRealizado sem a injeção endovenosa do meio de contraste iodado.';
    expect(classificarDocumento(texto).contraste).toBe('sem');
  });

  it('gatilho de fase isolado: "fase arterial" sozinho (sem citar "contraste" na mesma frase) → com contraste', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DE ABDOME TOTAL\n\nAdquiridos cortes na fase arterial.';
    expect(classificarDocumento(texto).contraste).toBe('com');
  });
});

describe('agruparClusters', () => {
  it('colapsa joelho esquerdo + joelho direito num único cluster com lateral=true', () => {
    const docs = [
      { arquivo: 'a.md', c: classificarDocumento('TOMOGRAFIA COMPUTADORIZADA DO JOELHO ESQUERDO') },
      { arquivo: 'b.md', c: classificarDocumento('TOMOGRAFIA COMPUTADORIZADA DO JOELHO DIREITO') },
    ];
    const clusters = agruparClusters(docs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      chave: 'tc-joelho',
      modalidade: 'tc',
      exame: 'joelho',
      contraste: 'sem',
      lateral: true,
      arquivos: ['a.md', 'b.md'],
    });
  });

  it('separa com/sem contraste em clusters distintos e gera a chave compatível com o id real da biblioteca', () => {
    const docs = [
      {
        arquivo: 'com.md',
        c: classificarDocumento(
          'TOMOGRAFIA COMPUTADORIZADA DE ABDOME TOTAL\n\nCom a administração intravenosa do meio de contraste.',
        ),
      },
      {
        arquivo: 'sem.md',
        c: classificarDocumento(
          'TOMOGRAFIA COMPUTADORIZADA DE ABDOME TOTAL\n\nSem a administração intravenosa do meio de contraste.',
        ),
      },
    ];
    const clusters = agruparClusters(docs);
    expect(clusters).toHaveLength(2);
    const comContraste = clusters.find((c) => c.contraste === 'com');
    const semContraste = clusters.find((c) => c.contraste === 'sem');
    expect(comContraste?.chave).toBe('tc-abdome-total-com-contraste');
    expect(semContraste?.chave).toBe('tc-abdome-total');
  });

  it('documentos com título irreconhecível caem no cluster "nao-reconhecido"', () => {
    const docs = [{ arquivo: 'x.md', c: classificarDocumento('DOCUMENTO SEM TÍTULO DE EXAME') }];
    const clusters = agruparClusters(docs);
    expect(clusters[0]?.chave).toBe('desconhecida-nao-reconhecido');
    expect(clusters[0]?.exame).toBeNull();
  });
});

describe('sugerirMaskId', () => {
  it('retorna a própria chave do cluster, no padrão da biblioteca (ex.: tc-abdome-total-com-contraste)', () => {
    const cluster = agruparClusters([
      {
        arquivo: 'x.md',
        c: classificarDocumento(
          'TOMOGRAFIA COMPUTADORIZADA DE ABDOME TOTAL\n\nCom a administração intravenosa do meio de contraste.',
        ),
      },
    ])[0];
    expect(cluster).toBeDefined();
    if (cluster) expect(sugerirMaskId(cluster)).toBe('tc-abdome-total-com-contraste');
  });

  it('id sem contraste não leva sufixo (ex.: tc-cranio)', () => {
    const cluster = agruparClusters([{ arquivo: 'x.md', c: classificarDocumento('TOMOGRAFIA COMPUTADORIZADA DE CRÂNIO') }])[0];
    expect(cluster).toBeDefined();
    if (cluster) expect(sugerirMaskId(cluster)).toBe('tc-cranio');
  });
});

// Blindagem exigida pelo review: a verificação anterior contra os 18 ids reais usava
// TÍTULOS SINTÉTICOS digitados à mão (não os arquivos de verdade), o que deixou passar
// dois bugs reais (colisão tornozelo/pé em tc-pe.md; fraseado "uso intravenoso" em
// tc-cranio.md). Este bloco lê os arquivos `tc-*.md` DE VERDADE, em disco, e não tem
// nenhuma lista de títulos hardcoded — se algum arquivo real da base divergir do que o
// classificador produz, este teste falha apontando o arquivo exato.
describe('regressão real contra biblioteca-base/tc-*.md (sem títulos sintéticos)', () => {
  const BIBLIOTECA_BASE = resolve(import.meta.dirname, '..', '..', '..', 'biblioteca-base');
  const arquivos = readdirSync(BIBLIOTECA_BASE).filter((f) => /^tc-.*\.md$/.test(f));

  it('encontrou os 18 arquivos tc-*.md em disco (sanity check do próprio teste — se isto falhar, o teste abaixo está vazio e passando por engano)', () => {
    expect(arquivos.length).toBe(18);
  });

  it.each(arquivos)('%s: sugerirMaskId(classificarDocumento(título+Técnica real do arquivo)) === id do frontmatter', (arquivo) => {
    const bruto = readFileSync(resolve(BIBLIOTECA_BASE, arquivo), 'utf8');
    const { data, content } = matter(bruto);
    const frontmatter = data as Record<string, unknown>;
    const idReal = typeof frontmatter.id === 'string' ? frontmatter.id : null;
    expect(idReal, `${arquivo}: frontmatter sem "id" string válido`).not.toBeNull();

    // Só título + Técnica (corta antes de "Análise:") — é o que o classificador usa
    // (título para modalidade/exame, texto inteiro do trecho para contraste); o corpo de
    // achados por órgão não faz parte do que um import real teria como "cabeçalho".
    const tituloETecnica = content.split(/\n\s*an[aá]lise\s*:?\s*\n/i)[0] ?? content;

    const classificacao = classificarDocumento(tituloETecnica);
    const cluster = agruparClusters([{ arquivo, c: classificacao }])[0];
    expect(cluster, `${arquivo}: agruparClusters não produziu cluster`).toBeDefined();
    if (cluster) {
      expect(
        sugerirMaskId(cluster),
        `${arquivo}: esperado id="${idReal}", classificação=${JSON.stringify(classificacao)}`,
      ).toBe(idReal);
    }
  });
});
