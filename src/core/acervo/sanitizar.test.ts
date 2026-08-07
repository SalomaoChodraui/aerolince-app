import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Classificacao } from './classificar.js';
import { corpoDoArquivo, sanitizarParaAcervo } from './sanitizar.js';

const TC_CRANIO: Classificacao = { modalidade: 'tc', exame: 'cranio', contraste: 'sem', lateral: false };
const DESCONHECIDA: Classificacao = { modalidade: 'desconhecida', exame: null, contraste: 'sem', lateral: false };

describe('sanitizarParaAcervo', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acervo-sanitizar-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('grava frontmatter de proveniência e sanitiza o corpo (nome do arquivo mascarado no conteúdo)', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nPaciente: JOAO DA SILVA.\nSem alterações.';
    const r = sanitizarParaAcervo({
      texto,
      nomeOriginal: '2026-01-05_00042_CRANIO_JOAO-DA-SILVA.pdf',
      classif: TC_CRANIO,
      acervoDir: dir,
      indice: 1,
    });
    const bruto = readFileSync(r.arquivo, 'utf8');
    const { data, content } = matter(bruto);
    expect(data).toMatchObject({
      exame: 'tc-cranio',
      modalidade: 'tc',
      contraste: 'sem',
      confianca: 'alta',
    });
    expect(typeof data.origem_hash).toBe('string');
    expect(data.origem_hash).toHaveLength(12);
    expect(content).not.toContain('JOAO');
    expect(content).toContain('[NOME]');
  });

  it('hash estável: o mesmo texto original produz sempre o mesmo origem_hash (12 hex do sha256)', () => {
    const texto = 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nSem alterações.';
    const r1 = sanitizarParaAcervo({ texto, nomeOriginal: 'a.txt', classif: TC_CRANIO, acervoDir: dir, indice: 1 });
    const r2 = sanitizarParaAcervo({ texto, nomeOriginal: 'b.txt', classif: TC_CRANIO, acervoDir: dir, indice: 2 });
    const h1 = matter(readFileSync(r1.arquivo, 'utf8')).data.origem_hash as string;
    const h2 = matter(readFileSync(r2.arquivo, 'utf8')).data.origem_hash as string;
    const esperado = createHash('sha256').update(texto, 'utf8').digest('hex').slice(0, 12);
    expect(h1).toBe(esperado);
    expect(h2).toBe(esperado);
  });

  it('nome de arquivo fora do padrão AAAA-MM-DD da clínica → "s-d" (nunca a data de hoje)', () => {
    const r = sanitizarParaAcervo({
      texto: 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nlaudo solto, sem nome de arquivo padronizado.',
      nomeOriginal: 'laudo-solto-qualquer.pdf',
      classif: TC_CRANIO,
      acervoDir: dir,
      indice: 3,
    });
    expect(r.arquivo.endsWith('tc-cranio_s-d_003.md')).toBe(true);
  });

  it('extrai a data do nome original quando segue o padrão AAAA-MM-DD_ da clínica', () => {
    const r = sanitizarParaAcervo({
      texto: 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nlaudo.',
      nomeOriginal: '2026-02-10_00001_CRANIO_MARIA-SOUZA.pdf',
      classif: TC_CRANIO,
      acervoDir: dir,
      indice: 7,
    });
    expect(r.arquivo.endsWith('tc-cranio_2026-02-10_007.md')).toBe(true);
  });

  it('suspeito=true quando o nome do arquivo indica paciente mas o corpo não continha o nome (0 findings tipo nome)', () => {
    const r = sanitizarParaAcervo({
      texto: 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nSem qualquer nome próprio no corpo.',
      nomeOriginal: '2026-01-05_00042_CRANIO_JOAO-DA-SILVA.pdf',
      classif: TC_CRANIO,
      acervoDir: dir,
      indice: 1,
    });
    expect(r.suspeito).toBe(true);
    expect(r.findings).toBe(0);
  });

  it('suspeito=false quando o nome do arquivo aparece (e é mascarado) no corpo', () => {
    const r = sanitizarParaAcervo({
      texto: 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nPaciente: JOAO DA SILVA.\nSem alterações.',
      nomeOriginal: '2026-01-05_00042_CRANIO_JOAO-DA-SILVA.pdf',
      classif: TC_CRANIO,
      acervoDir: dir,
      indice: 1,
    });
    expect(r.suspeito).toBe(false);
    expect(r.findings).toBeGreaterThan(0);
  });

  it('suspeito=false quando o nome do arquivo não segue o padrão da clínica (nada a verificar)', () => {
    const r = sanitizarParaAcervo({
      texto: 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nlaudo qualquer.',
      nomeOriginal: 'sem-padrao.pdf',
      classif: TC_CRANIO,
      acervoDir: dir,
      indice: 1,
    });
    expect(r.suspeito).toBe(false);
  });

  it('confiança "baixa" quando modalidade/exame não são reconhecidos; "alta" quando são', () => {
    const baixa = sanitizarParaAcervo({
      texto: 'documento sem título reconhecível de exame algum.',
      nomeOriginal: 'x.txt',
      classif: DESCONHECIDA,
      acervoDir: dir,
      indice: 1,
    });
    const dataBaixa = matter(readFileSync(baixa.arquivo, 'utf8')).data;
    expect(dataBaixa.confianca).toBe('baixa');

    const alta = sanitizarParaAcervo({
      texto: 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nSem alterações.',
      nomeOriginal: 'y.txt',
      classif: TC_CRANIO,
      acervoDir: dir,
      indice: 2,
    });
    const dataAlta = matter(readFileSync(alta.arquivo, 'utf8')).data;
    expect(dataAlta.confianca).toBe('alta');
  });

  it('nome do arquivo gravado nunca contém nome de paciente — só chave de cluster + data|s-d + índice', () => {
    const r = sanitizarParaAcervo({
      texto: 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nlaudo.',
      nomeOriginal: '2026-01-05_00042_CRANIO_JOAO-DA-SILVA.pdf',
      classif: TC_CRANIO,
      acervoDir: dir,
      indice: 1,
    });
    expect(r.arquivo).not.toMatch(/JOAO|SILVA/i);
  });

  it('cria o acervoDir quando ainda não existe', () => {
    const alvo = join(dir, 'ainda-nao-existe');
    const r = sanitizarParaAcervo({
      texto: 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO\n\nlaudo.',
      nomeOriginal: 'z.txt',
      classif: TC_CRANIO,
      acervoDir: alvo,
      indice: 1,
    });
    expect(readFileSync(r.arquivo, 'utf8')).toContain('exame: tc-cranio');
  });
});

describe('corpoDoArquivo', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acervo-corpo-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('arquivo com frontmatter → devolve só o content (sem o YAML)', () => {
    const caminho = join(dir, 'novo.md');
    writeFileSync(caminho, '---\nexame: tc-cranio\nmodalidade: tc\n---\nCORPO SANITIZADO DO LAUDO\n', 'utf8');
    expect(corpoDoArquivo(caminho).trim()).toBe('CORPO SANITIZADO DO LAUDO');
  });

  it('arquivo legado sem frontmatter → devolve o arquivo inteiro', () => {
    const caminho = join(dir, 'legado.txt');
    const bruto = 'TEXTO LEGADO INTEIRO, SEM FRONTMATTER ALGUM\n';
    writeFileSync(caminho, bruto, 'utf8');
    expect(corpoDoArquivo(caminho)).toBe(bruto);
  });
});
