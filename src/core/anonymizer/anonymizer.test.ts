import { describe, expect, it } from 'vitest';
import { examTypeFromFilename, patientNameFromFilename, sanitize, sanitizeComando } from './anonymizer.js';

describe('sanitize', () => {
  it('mascara linha "Paciente:" preservando o rótulo', () => {
    const r = sanitize('Paciente: João da Silva Sauro\nExame de tórax normal.');
    expect(r.clean).toContain('Paciente: [NOME]');
    expect(r.clean).not.toContain('João');
    expect(r.findings.some((f) => f.tipo === 'nome')).toBe(true);
  });

  it('mascara "Dr." e "Dra." com nome composto', () => {
    const r = sanitize('Assinado por Dra. Maria Costa e Dr. José dos Santos Almeida.');
    expect(r.clean).not.toContain('Maria');
    expect(r.clean).not.toContain('Almeida');
    expect(r.clean).toMatch(/Dra\. \[NOME\]/);
  });

  it('mascara CPF formatado e IDs rotulados', () => {
    const r = sanitize('CPF: 123.456.789-01. Prontuário: 445566. Registro nº: 12345.');
    expect(r.clean).not.toContain('123.456.789-01');
    expect(r.clean).not.toContain('445566');
    expect(r.clean).toContain('Prontuário: [ID]');
  });

  it('mascara datas numéricas e por extenso', () => {
    const r = sanitize('Exame realizado em 15/07/2026, comparado ao de 3 de maio de 2025.');
    expect(r.clean).not.toContain('15/07/2026');
    expect(r.clean).not.toContain('maio');
    expect((r.clean.match(/\[DATA\]/g) ?? []).length).toBe(2);
  });

  it('mascara telefone formatado', () => {
    const r = sanitize('Contato: (11) 98765-4321.');
    expect(r.clean).not.toContain('98765');
    expect(r.clean).toContain('[TEL]');
  });

  it('mascara CRM', () => {
    const r = sanitize('Dr. João Silva — CRM/SP 123456');
    expect(r.clean).not.toContain('123456');
  });

  it('PRESERVA medidas e valores clínicos', () => {
    const texto =
      'Cálculo de 1,0 cm no rim direito, com densidade de 500 UH, distando 10 cm da pele. ' +
      'Nódulo de 8 mm no segmento VI. Espessura de 3,5 mm. Volume de 120 ml.';
    const r = sanitize(texto);
    expect(r.clean).toContain('1,0 cm');
    expect(r.clean).toContain('500 UH');
    expect(r.clean).toContain('10 cm da pele');
    expect(r.clean).toContain('8 mm');
    expect(r.clean).toContain('120 ml');
  });

  it('mascara nomes conhecidos (do arquivo) em qualquer caixa e separador', () => {
    const r = sanitize(
      'Laudo de Israel Andretta. O paciente ISRAEL-ANDRETTA compareceu…',
      { extraNames: ['ISRAEL ANDRETTA'] },
    );
    expect(r.clean).not.toMatch(/israel/i);
    expect((r.clean.match(/\[NOME\]/g) ?? []).length).toBe(2);
  });

  it('casa nome sem acento do arquivo com nome acentuado no corpo', () => {
    const r = sanitize('Laudo de José Gonçalves Ferreira, exame normal.', {
      extraNames: ['JOSE GONCALVES FERREIRA'],
    });
    expect(r.clean).not.toContain('José');
    expect(r.clean).toContain('[NOME]');
  });

  it('não altera texto clínico sem identificadores', () => {
    const texto =
      'Fígado com forma, dimensões e coeficientes de atenuação preservados. ' +
      'Vesícula biliar normodistendida, sem cálculos radiopacos.';
    const r = sanitize(texto);
    expect(r.clean).toBe(texto);
    expect(r.findings).toHaveLength(0);
  });
});

describe('patientNameFromFilename', () => {
  it('extrai nome do padrão real dos arquivos', () => {
    expect(patientNameFromFilename('2026-07-15_32546_ABDOME-TOTAL_ISRAEL-ANDRETTA.pdf')).toBe(
      'ISRAEL ANDRETTA',
    );
    expect(
      patientNameFromFilename('2026-07-03_32495_ABDOME-TOTAL_CRISTINA-GOMES-BORGES-DE-QUEIROZ-ALMEIDA.pdf'),
    ).toBe('CRISTINA GOMES BORGES DE QUEIROZ ALMEIDA');
  });

  it('retorna null para padrões inesperados', () => {
    expect(patientNameFromFilename('laudo.pdf')).toBeNull();
  });
});

describe('examTypeFromFilename', () => {
  it('extrai o tipo de exame', () => {
    expect(examTypeFromFilename('2026-07-02_32488_TORAX_FULANO-DE-TAL.pdf')).toBe('TORAX');
    expect(examTypeFromFilename('2026-07-10_32506_COL-CERVICAL_FULANA.pdf')).toBe('COL-CERVICAL');
  });
});

describe('sanitizeComando (ditado → LLM)', () => {
  it('mascara nome e CPF, PRESERVANDO o conteúdo clínico ao redor', () => {
    const r = sanitizeComando('tomografia de abdome do paciente João da Silva, CPF 123.456.789-00, com diverticulite');
    expect(r.texto).toContain('[NOME]');
    expect(r.texto).toContain('[CPF]');
    expect(r.texto).not.toContain('João');
    expect(r.texto).toContain('com diverticulite'); // o achado sobrevive à sanitização
    expect(r.avisos.length).toBe(2);
  });

  it('mascara nome ditado com pontuação de rótulo ("paciente: João da Silva")', () => {
    const r = sanitizeComando('paciente: João da Silva, apendicite aguda');
    expect(r.texto).not.toContain('João da Silva');
    expect(r.texto).toContain('apendicite aguda');
  });

  it('mascara número de prontuário ditado sem pontuação', () => {
    const r = sanitizeComando('prontuário 123456, tomografia de crânio normal');
    expect(r.texto).not.toContain('123456');
    expect(r.texto).toContain('tomografia de crânio normal');
  });

  it('NÃO remove data (conteúdo clínico), mas avisa', () => {
    const r = sanitizeComando('comparar com exame de 15/03/2026, estável');
    expect(r.texto).toContain('15/03/2026');
    expect(r.avisos.length).toBe(1);
  });

  it('comando limpo passa intacto e sem avisos', () => {
    const cmd = 'tomografia de abdome total com contraste, diverticulite do cólon direito não complicada';
    const r = sanitizeComando(cmd);
    expect(r.texto).toBe(cmd);
    expect(r.avisos).toEqual([]);
  });

  it('deduplica avisos do mesmo tipo', () => {
    const r = sanitizeComando('paciente João da Silva e solicitante Maria Souza Lima');
    expect(r.texto).not.toContain('João');
    expect(r.texto).not.toContain('Maria');
    expect(r.avisos.length).toBe(1);
  });

  it('mascara nome ÚNICO após o gatilho ("paciente Maria")', () => {
    const r = sanitizeComando('paciente Maria, dor abdominal em fossa ilíaca direita');
    expect(r.texto).not.toContain('Maria');
    expect(r.texto).toContain('[NOME]');
    expect(r.texto).toContain('dor abdominal em fossa ilíaca direita');
  });

  it('mascara prontuário com palavra de preenchimento ("prontuário número 123456")', () => {
    const r = sanitizeComando('prontuário número 123456, dor lombar');
    expect(r.texto).not.toContain('123456');
    expect(r.texto).toContain('dor lombar');
  });

  it('mascara prontuário com abreviação ("prontuário nº 123456")', () => {
    const r = sanitizeComando('prontuário nº 123456');
    expect(r.texto).not.toContain('123456');
    expect(r.texto).toContain('[ID]');
  });
});
