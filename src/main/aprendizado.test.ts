import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema, type Config } from '../core/config/schema.js';
import { corpusDoHistorico, listarEstilo, montarAlvosReaprender } from './aprendizado.js';

function cfg(o: { masksDir: string; outputDir: string; bibliotecaBaseDir: string; acervoDir: string }): Config {
  return ConfigSchema.parse({ ...o, profilesDir: '/x', stt: {}, llm: {} });
}

function criarLaudo(outputDir: string, nome: string, meta: Record<string, unknown> | null): void {
  writeFileSync(join(outputDir, `${nome}.txt`), 'laudo gerado', 'utf8');
  if (meta !== null) writeFileSync(join(outputDir, `${nome}.json`), JSON.stringify(meta), 'utf8');
}

describe('corpusDoHistorico', () => {
  let dir: string;
  const dirsParaLimpar: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aerolince-hist-corpus-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const d of dirsParaLimpar.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('outputDir inexistente devolve lista vazia', () => {
    expect(corpusDoHistorico(join(dir, 'nao-existe'), 40)).toEqual([]);
  });

  it('ignora laudos sem sidecar, sem laudoFinalEditado, ou com sidecar corrompido', () => {
    criarLaudo(dir, '2026-01-01_1000_a', null); // sem sidecar
    criarLaudo(dir, '2026-01-02_1000_b', { maskId: 'b' }); // sem edição
    writeFileSync(join(dir, '2026-01-03_1000_c.txt'), 'laudo', 'utf8');
    writeFileSync(join(dir, '2026-01-03_1000_c.json'), '{ inválido', 'utf8'); // sidecar corrompido
    expect(corpusDoHistorico(dir, 40)).toEqual([]);
  });

  it('inclui só os laudos com laudoFinalEditado, RE-SANITIZADOS, e devolve maskId + caminho temporário', () => {
    criarLaudo(dir, '2026-01-01_1000_torax-tc', {
      maskId: 'torax-tc',
      laudoFinalEditado: 'Achado benigno. CPF do paciente: 123.456.789-00 (não deveria sobreviver).',
    });
    const r = corpusDoHistorico(dir, 40);
    dirsParaLimpar.push(join(r[0]!.arquivo, '..'));

    expect(r).toHaveLength(1);
    expect(r[0]!.maskId).toBe('torax-tc');
    const conteudo = readFileSync(r[0]!.arquivo, 'utf8');
    expect(conteudo).toContain('Achado benigno.');
    expect(conteudo).toContain('[CPF]');
    expect(conteudo).not.toContain('123.456.789-00'); // re-sanitização obrigatória
  });

  it('maskId ausente no sidecar cai em "desconhecido" em vez de quebrar', () => {
    criarLaudo(dir, '2026-01-01_1000_x', { laudoFinalEditado: 'texto final' });
    const r = corpusDoHistorico(dir, 40);
    dirsParaLimpar.push(join(r[0]!.arquivo, '..'));
    expect(r[0]!.maskId).toBe('desconhecido');
  });

  it('aplica o cap mantendo os mais recentes (nomes datados → ordem lexicográfica = cronológica)', () => {
    for (let i = 1; i <= 5; i++) {
      criarLaudo(dir, `2026-01-0${i}_1000_m`, { maskId: 'm', laudoFinalEditado: `versão ${i}` });
    }
    const r = corpusDoHistorico(dir, 2);
    dirsParaLimpar.push(join(r[0]!.arquivo, '..'));
    expect(r).toHaveLength(2);
    const textos = r.map((item) => readFileSync(item.arquivo, 'utf8'));
    expect(textos).toEqual(['versão 4', 'versão 5']);
  });
});

const FRONTMATTER_MASCARA = (id: string, prefixos: string[]) =>
  `---\nid: ${id}\nmodalidade: tc\nnome: Máscara ${id}\nprefixos:\n${prefixos.map((p) => `  - ${p}`).join('\n')}\n---\ncorpo\n`;

describe('montarAlvosReaprender', () => {
  let masksDir: string;
  let baseDir: string;
  let acervoDir: string;
  let outputDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aerolince-reaprender-medico-'));
    baseDir = mkdtempSync(join(tmpdir(), 'aerolince-reaprender-base-'));
    acervoDir = mkdtempSync(join(tmpdir(), 'aerolince-reaprender-acervo-'));
    outputDir = mkdtempSync(join(tmpdir(), 'aerolince-reaprender-output-'));
  });

  afterEach(() => {
    for (const d of [masksDir, baseDir, acervoDir, outputDir]) rmSync(d, { recursive: true, force: true });
  });

  it('junta acervo + histórico editado da mesma máscara, histórico no fim (peso de recência)', () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    writeFileSync(join(acervoDir, 'torax-tc_2026-01-01_001.md'), 'laudo do acervo', 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', {
      maskId: 'torax-tc',
      laudoFinalEditado: 'edição do médico',
    });

    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });
    const r = montarAlvosReaprender(c);

    expect(r.semArquivos).toEqual([]);
    expect(r.alvos).toHaveLength(1);
    const alvo = r.alvos[0]!;
    expect(alvo).toMatchObject({ tipo: 'aprender', maskId: 'torax-tc' });
    expect(alvo.arquivos).toHaveLength(2);
    expect(alvo.arquivos[0]).toBe(join(acervoDir, 'torax-tc_2026-01-01_001.md'));
    expect(alvo.arquivos[1]).toContain('torax-tc'); // o temporário do histórico, no fim
  });

  it('cap de 60 por máscara: com o total além do cap, o histórico (no fim) sobrevive sobre o acervo mais antigo', () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    for (let i = 1; i <= 62; i++) {
      writeFileSync(join(acervoDir, `torax-tc_2026-01-${String(i).padStart(2, '0')}_001.md`), `laudo ${i}`, 'utf8');
    }
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição do médico' });

    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });
    const r = montarAlvosReaprender(c);

    const alvo = r.alvos[0]!;
    expect(alvo.arquivos).toHaveLength(60);
    expect(alvo.arquivos[59]).toContain('torax-tc'); // o do histórico, mantido no fim
    expect(alvo.arquivos).not.toContain(join(acervoDir, 'torax-tc_2026-01-01_001.md')); // o acervo mais antigo cede espaço
  });

  it('máscara com prefixos mas sem NENHUM laudo (acervo nem histórico) cai em semArquivos', () => {
    writeFileSync(join(masksDir, 'abdome-tc.md'), FRONTMATTER_MASCARA('abdome-tc', ['abdome-tc']), 'utf8');
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

    const r = montarAlvosReaprender(c);

    expect(r.alvos).toEqual([]);
    expect(r.semArquivos).toEqual([{ maskId: 'abdome-tc', nome: 'Máscara abdome-tc' }]);
  });

  it('máscara SEM prefixos configurados é ignorada (nem alvo, nem semArquivos)', () => {
    writeFileSync(join(masksDir, 'sem-prefixo.md'), FRONTMATTER_MASCARA('sem-prefixo', []), 'utf8');
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

    const r = montarAlvosReaprender(c);

    expect(r.alvos).toEqual([]);
    expect(r.semArquivos).toEqual([]);
  });

  it('acervoDir inexistente não quebra — histórico sozinho já monta o alvo', () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição' });
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir: join(acervoDir, 'nao-existe') });

    const r = montarAlvosReaprender(c);

    expect(r.alvos).toHaveLength(1);
    expect(r.alvos[0]!.arquivos).toHaveLength(1);
  });
});

describe('listarEstilo — origem de regras/frasário (médico vence a base)', () => {
  let masksDir: string;
  let baseDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aerolince-estilo-medico-'));
    baseDir = mkdtempSync(join(tmpdir(), 'aerolince-estilo-base-'));
    // biblioteca precisa de ao menos 1 máscara para loadLibrary não lançar
    writeFileSync(join(baseDir, 'generica.md'), FRONTMATTER_MASCARA('generica', []), 'utf8');
  });

  afterEach(() => {
    rmSync(masksDir, { recursive: true, force: true });
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('item só na base → origemEfetiva "base"; item só do médico ou nas duas camadas → "minha"', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'aerolince-estilo-out-'));
    const acervoDir = mkdtempSync(join(tmpdir(), 'aerolince-estilo-acervo-'));
    try {
      mkdirSync(join(baseDir, 'regras'), { recursive: true });
      mkdirSync(join(masksDir, 'regras'), { recursive: true });
      writeFileSync(join(baseDir, 'regras', 'gerais.md'), 'regra base', 'utf8');
      writeFileSync(join(masksDir, 'regras', 'gerais.md'), 'regra sobrescrita pelo médico', 'utf8');
      const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

      const r = listarEstilo(c);

      expect(r.regras).toEqual([{ nome: 'gerais', origemEfetiva: 'minha' }]);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(acervoDir, { recursive: true, force: true });
    }
  });
});
