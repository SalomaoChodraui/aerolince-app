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
