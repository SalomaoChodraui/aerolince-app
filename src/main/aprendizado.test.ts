import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, type Config } from '../core/config/schema.js';
import type { CompleteParams, LLMResult } from '../core/llm/types.js';
import {
  type AlvoAprendizado,
  arquivoPermitidoParaAprendizado,
  cancelarAprendizado,
  corpusDoHistorico,
  estimarAprendizado,
  limparCorpusHistoricoOrfao,
  listarEstilo,
  montarAlvosReaprender,
  rodarAprendizado,
} from './aprendizado.js';

// `rodarAprendizado` chama `criarLLM(config)` internamente (não é injetável) — para simular o
// fluxo completo (inclusive a limpeza dos temporários DEPOIS da "chamada ao LLM") sem rede real,
// mocka-se só `criarLLM` do factory, preservando o resto do módulo (`chavesNecessarias` etc.,
// usado por `exigirChaves` em `pipeline.ts`) via `importOriginal`.
const llmFake: { handler: (params: CompleteParams) => Promise<LLMResult> } = vi.hoisted(() => ({
  handler: async () => ({
    text: 'resposta padrão do fake',
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  }),
}));
vi.mock('../core/llm/factory.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../core/llm/factory.js')>();
  return {
    ...real,
    criarLLM: () => ({
      llm: { complete: (params: CompleteParams) => llmFake.handler(params) },
      modelos: { selecao: 'fake', geracao: 'fake', rapido: 'fake' },
    }),
  };
});

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

// Flow-style YAML (`prefixos: [a, b]` / `prefixos: []`) em vez de bloco — bloco vazio
// (`prefixos:\n` sem itens embaixo) parseia como `null`, não `[]`, e faz o zod
// (`prefixos` tipado como array) rejeitar a máscara inteira; com o array vazio "sumindo"
// silenciosamente em `loadLibrary` (try/catch → `masks = []`), um teste de máscara SEM
// prefixos passaria por acidente mesmo com a lógica errada (nenhuma máscara carregada =
// nenhum alvo, nenhum semArquivos, o mesmo resultado esperado por coincidência).
const FRONTMATTER_MASCARA = (id: string, prefixos: string[]) =>
  `---\nid: ${id}\nmodalidade: tc\nnome: Máscara ${id}\nprefixos: [${prefixos.join(', ')}]\n---\ncorpo\n`;

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
    // I3: com histórico no corpus, o wizard precisa saber (para exigir consentimento) e
    // ter amostras sanitizadas prontas para mostrar antes de liberar "Aprender meu estilo".
    expect(r.temHistorico).toBe(true);
    expect(r.amostras.length).toBeGreaterThan(0);
    expect(r.amostras.length).toBeLessThanOrEqual(3);
    expect(r.amostras[0]!.texto.length).toBeGreaterThan(0);
  });

  it('I3: temHistorico é false quando só há acervo (nenhuma edição no histórico) — consentimento já dado na importação original', () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    writeFileSync(join(acervoDir, 'torax-tc_2026-01-01_001.md'), 'laudo do acervo', 'utf8');
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

    const r = montarAlvosReaprender(c);

    expect(r.alvos).toHaveLength(1);
    expect(r.temHistorico).toBe(false);
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

  it('máscara SEM prefixos configurados E sem nenhum laudo é ignorada (nem alvo, nem semArquivos)', () => {
    writeFileSync(join(masksDir, 'sem-prefixo.md'), FRONTMATTER_MASCARA('sem-prefixo', []), 'utf8');
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

    const r = montarAlvosReaprender(c);

    expect(r.alvos).toEqual([]);
    expect(r.semArquivos).toEqual([]);
  });

  // C1 (regressão obrigatória): TODA a biblioteca-base e as máscaras destiladas pelo wizard têm
  // `prefixos: []` — antes do fix, `montarAlvosReaprender` as filtrava fora de cara
  // (`masks.filter(m => m.prefixos.length > 0)`) e "Reaprender" sempre dizia "nenhum laudo",
  // mesmo com o acervo cheio de arquivos `<id>_...` daquele exato maskId.
  it('C1: máscara-base (prefixos: []) com arquivos no ACERVO nomeados <id>_... vira alvo (casamento por id, não só por prefixos)', () => {
    writeFileSync(join(masksDir, 'abdome-tc.md'), FRONTMATTER_MASCARA('abdome-tc', []), 'utf8');
    writeFileSync(join(acervoDir, 'abdome-tc_2026-01-01_001.md'), 'laudo do acervo 1', 'utf8');
    writeFileSync(join(acervoDir, 'abdome-tc_2026-01-02_002.md'), 'laudo do acervo 2', 'utf8');
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

    const r = montarAlvosReaprender(c);

    expect(r.semArquivos).toEqual([]);
    expect(r.alvos).toHaveLength(1);
    expect(r.alvos[0]).toMatchObject({ tipo: 'aprender', maskId: 'abdome-tc' });
    expect(r.alvos[0]!.arquivos).toEqual([
      join(acervoDir, 'abdome-tc_2026-01-01_001.md'),
      join(acervoDir, 'abdome-tc_2026-01-02_002.md'),
    ]);
  });

  // C1 (regressão obrigatória): máscara com prefixos: [] e ZERO arquivos no acervo, mas com
  // edição no histórico — também precisa virar alvo (o histórico casa por maskId, não por prefixos).
  it('C1: máscara-base (prefixos: []) com laudo só no HISTÓRICO EDITADO (sem nada no acervo) também vira alvo', () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', []), 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição do médico' });
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

    const r = montarAlvosReaprender(c);

    expect(r.semArquivos).toEqual([]);
    expect(r.alvos).toHaveLength(1);
    expect(r.alvos[0]).toMatchObject({ tipo: 'aprender', maskId: 'torax-tc' });
    expect(r.alvos[0]!.arquivos).toHaveLength(1);
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

describe('estimarAprendizado — cap de 60 arquivos por alvo (I1)', () => {
  let dir: string;
  let acervoDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aerolince-estimar-cap-'));
    acervoDir = mkdtempSync(join(tmpdir(), 'aerolince-estimar-cap-acervo-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(acervoDir, { recursive: true, force: true });
  });

  it('alvo com 200 arquivos: a estimativa considera só os 60 mais recentes — o mesmo cap da execução', () => {
    const arquivos: string[] = [];
    for (let i = 0; i < 200; i++) {
      const caminho = join(dir, `laudo-${String(i).padStart(3, '0')}.md`);
      // Os primeiros 140 (descartados pelo cap) são bem maiores que os últimos 60 (mantidos) —
      // se o cap NÃO for aplicado, o custo estimado dispara por causa desses arquivos grandes.
      const texto = i < 140 ? 'x'.repeat(5000) : 'y'.repeat(10);
      writeFileSync(caminho, texto, 'utf8');
      arquivos.push(caminho);
    }
    const config = cfg({ masksDir: dir, outputDir: dir, bibliotecaBaseDir: dir, acervoDir });
    const alvo: AlvoAprendizado = { tipo: 'aprender', chave: 'x', maskId: 'torax-tc', arquivos };

    const r = estimarAprendizado([alvo], config);
    // Referência: o mesmo cálculo aplicado só aos 60 mais recentes — o que a execução
    // (`rodarAprendizado`/`arquivosComCap`) de fato envia ao LLM.
    const esperado = estimarAprendizado([{ ...alvo, arquivos: arquivos.slice(-60) }], config);

    expect(r.porAlvo[0]!.custoAproxUSD).not.toBeNull();
    expect(r.porAlvo[0]!.custoAproxUSD).toBe(esperado.porAlvo[0]!.custoAproxUSD);
  });
});

describe('rodarAprendizado — cap de 60 arquivos por alvo, mesmo ponto da estimativa (I1)', () => {
  let masksDir: string;
  let baseDir: string;
  let acervoDir: string;
  let outputDir: string;
  let corpusDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aerolince-rodar-cap-medico-'));
    baseDir = mkdtempSync(join(tmpdir(), 'aerolince-rodar-cap-base-'));
    acervoDir = mkdtempSync(join(tmpdir(), 'aerolince-rodar-cap-acervo-'));
    outputDir = mkdtempSync(join(tmpdir(), 'aerolince-rodar-cap-output-'));
    corpusDir = mkdtempSync(join(tmpdir(), 'aerolince-rodar-cap-corpus-'));
    vi.stubEnv('OPENAI_API_KEY', 'sk-fake');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-fake');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const d of [masksDir, baseDir, acervoDir, outputDir, corpusDir]) rmSync(d, { recursive: true, force: true });
  });

  it('um cluster com 80 arquivos manda só os 60 mais recentes ao LLM (o wizard não capava antes)', async () => {
    const arquivos: string[] = [];
    for (let i = 0; i < 80; i++) {
      const caminho = join(corpusDir, `laudo-${String(i).padStart(3, '0')}.md`);
      writeFileSync(caminho, i === 0 ? 'MARCADOR-MAIS-ANTIGO' : i === 79 ? 'MARCADOR-MAIS-RECENTE' : `conteúdo ${i}`, 'utf8');
      arquivos.push(caminho);
    }
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

    let userRecebidoPeloLlm = '';
    llmFake.handler = async (params) => {
      userRecebidoPeloLlm = params.user;
      return { text: 'regras extraídas', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };

    const alvo: AlvoAprendizado = { tipo: 'aprender', chave: 'x', maskId: 'torax-tc', arquivos };
    const r = await rodarAprendizado([alvo], c);

    expect(r.falhas).toEqual([]);
    const quantidadeDeLaudos = (userRecebidoPeloLlm.match(/─── LAUDO \d+ ───/g) ?? []).length;
    expect(quantidadeDeLaudos).toBe(60);
    expect(userRecebidoPeloLlm).toContain('MARCADOR-MAIS-RECENTE'); // o mais recente sobrevive ao cap
    expect(userRecebidoPeloLlm).not.toContain('MARCADOR-MAIS-ANTIGO'); // o mais antigo é descartado pelo cap
  });
});

describe('rodarAprendizado — alvo "destilar" grava prefixos (C1)', () => {
  let masksDir: string;
  let baseDir: string;
  let acervoDir: string;
  let outputDir: string;
  let corpusDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aerolince-destilar-medico-'));
    baseDir = mkdtempSync(join(tmpdir(), 'aerolince-destilar-base-'));
    acervoDir = mkdtempSync(join(tmpdir(), 'aerolince-destilar-acervo-'));
    outputDir = mkdtempSync(join(tmpdir(), 'aerolince-destilar-output-'));
    corpusDir = mkdtempSync(join(tmpdir(), 'aerolince-destilar-corpus-'));
    vi.stubEnv('OPENAI_API_KEY', 'sk-fake');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-fake');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const d of [masksDir, baseDir, acervoDir, outputDir, corpusDir]) rmSync(d, { recursive: true, force: true });
  });

  it('passa prefixos: [maskId] para destilarMascara — frontmatter do rascunho não sai vazio', async () => {
    const arquivo = join(corpusDir, 'exame-novo_2026-01-01_001.md');
    writeFileSync(arquivo, 'laudo de exemplo para destilar', 'utf8');
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });

    let userRecebidoPeloLlm = '';
    llmFake.handler = async (params) => {
      userRecebidoPeloLlm = params.user;
      return { text: '## Máscara\n\nconteúdo', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };

    const alvo = { tipo: 'destilar' as const, chave: 'exame-novo', maskId: 'exame-novo', arquivos: [arquivo] };
    const r = await rodarAprendizado([alvo], c);

    expect(r.falhas).toEqual([]);
    expect(userRecebidoPeloLlm).toContain('prefixos: [exame-novo]');
  });
});

describe('rodarAprendizado — higiene de privacidade: limpeza do corpus temporário do histórico', () => {
  let masksDir: string;
  let baseDir: string;
  let acervoDir: string;
  let outputDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aerolince-limpeza-medico-'));
    baseDir = mkdtempSync(join(tmpdir(), 'aerolince-limpeza-base-'));
    acervoDir = mkdtempSync(join(tmpdir(), 'aerolince-limpeza-acervo-'));
    outputDir = mkdtempSync(join(tmpdir(), 'aerolince-limpeza-output-'));
    vi.stubEnv('OPENAI_API_KEY', 'sk-fake');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-fake');
    llmFake.handler = async () => ({
      text: '## Limites do protocolo\n\nnada.',
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const d of [masksDir, baseDir, acervoDir, outputDir]) rmSync(d, { recursive: true, force: true });
  });

  it('o tempdir do histórico existe ANTES de rodar, sobrevive até a chamada ao LLM, e some DEPOIS (sucesso)', async () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição do médico' });
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });
    const { alvos } = montarAlvosReaprender(c);
    const tempDir = dirname(alvos[0]!.arquivos[0]!);
    expect(existsSync(tempDir)).toBe(true); // criado por montarAlvosReaprender, ainda não consumido

    let existiaNaChamadaAoLlm = false;
    llmFake.handler = async () => {
      existiaNaChamadaAoLlm = existsSync(tempDir); // o corpus já foi lido (montarCorpus) a essa altura
      return { text: 'regras extraídas', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };

    const r = await rodarAprendizado(alvos, c);

    expect(r.falhas).toEqual([]);
    expect(existiaNaChamadaAoLlm).toBe(true);
    expect(existsSync(tempDir)).toBe(false); // limpo depois que o lote terminou
  });

  it('também limpa em caso de FALHA de um alvo (o corpus já foi lido, não precisa sobreviver ao erro)', async () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição do médico' });
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });
    const { alvos } = montarAlvosReaprender(c);
    const tempDir = dirname(alvos[0]!.arquivos[0]!);

    llmFake.handler = async () => {
      throw new Error('LLM indisponível (simulado)');
    };

    const r = await rodarAprendizado(alvos, c);

    expect(r.falhas).toHaveLength(1);
    expect(existsSync(tempDir)).toBe(false);
  });

  // I2: inverte o comportamento anterior — o gate falhando ANTES do laço significa que o
  // corpus nunca chegou a ser lido, então os tempdirs precisam SOBREVIVER (não virar ENOENT
  // no retry). Quem cobre a limpeza deste caso é o sweep de `limparCorpusHistoricoOrfao`
  // (boot / fechar a janela de importação), não o `finally` de `rodarAprendizado`.
  it('I2: NÃO limpa quando o GATE de chaves falha (nunca chega a ler o corpus) — sobrevive para o retry', async () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição do médico' });
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });
    const { alvos } = montarAlvosReaprender(c);
    const tempDir = dirname(alvos[0]!.arquivos[0]!);
    vi.stubEnv('ANTHROPIC_API_KEY', ''); // gate falha antes de qualquer LLM

    await expect(rodarAprendizado(alvos, c)).rejects.toThrow(/ANTHROPIC_API_KEY/);

    expect(existsSync(tempDir)).toBe(true);
  });

  // I2 (regressão obrigatória): "gate falha → tempdirs sobrevivem → segundo rodar (com chave)
  // encontra os arquivos" — reusa o MESMO `alvos` (plano já montado na tela) entre as duas
  // tentativas, como o wizard faz de verdade (não remonta os alvos ao clicar de novo).
  it('I2: retry após falha de gate acha os MESMOS arquivos do primeiro plano (sem ENOENT)', async () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição do médico' });
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });
    const { alvos } = montarAlvosReaprender(c);
    const tempDir = dirname(alvos[0]!.arquivos[0]!);

    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(rodarAprendizado(alvos, c)).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(existsSync(tempDir)).toBe(true); // sobreviveu à 1ª tentativa (gate falhou)

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-fake'); // médico configura a chave e clica de novo
    const r = await rodarAprendizado(alvos, c); // MESMO array `alvos` — sem remontar o plano

    expect(r.falhas).toEqual([]);
    expect(r.ok).toHaveLength(1);
    expect(existsSync(tempDir)).toBe(false); // limpo depois que o retry, agora, terminou de verdade
  });

  it('também limpa quando CANCELADO no meio do lote (2º alvo nunca chega a rodar)', async () => {
    // 2 máscaras (ordem alfabética: abdome-tc antes de torax-tc — mesma ordem de `loadLibrary`),
    // cada uma com um laudo editado no histórico → 1 tempdir só, compartilhado pelos 2 alvos.
    writeFileSync(join(masksDir, 'abdome-tc.md'), FRONTMATTER_MASCARA('abdome-tc', ['abdome-tc']), 'utf8');
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_abdome-tc', { maskId: 'abdome-tc', laudoFinalEditado: 'edição 1' });
    criarLaudo(outputDir, '2026-02-02_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição 2' });
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });
    const { alvos } = montarAlvosReaprender(c);
    expect(alvos.map((a) => a.maskId)).toEqual(['abdome-tc', 'torax-tc']);
    const tempDir = dirname(alvos[0]!.arquivos[0]!);
    expect(dirname(alvos[1]!.arquivos[0]!)).toBe(tempDir); // os dois compartilham o mesmo tempdir

    llmFake.handler = async () => {
      cancelarAprendizado(); // simula o médico clicando "Cancelar" enquanto o 1º alvo roda
      return { text: 'regras do 1º alvo', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };

    const r = await rodarAprendizado(alvos, c);

    expect(r.ok).toHaveLength(1); // 1º alvo completou antes do cancelamento surtir efeito
    expect(r.falhas).toEqual([]); // 2º alvo nem chegou a rodar — não é falha, é "não começou"
    expect(existsSync(tempDir)).toBe(false); // limpo mesmo com o lote interrompido no meio
  });

  it('não mexe em arquivos reais do acervo, só nos temporários do histórico', async () => {
    writeFileSync(join(masksDir, 'torax-tc.md'), FRONTMATTER_MASCARA('torax-tc', ['torax-tc']), 'utf8');
    writeFileSync(join(acervoDir, 'torax-tc_2026-01-01_001.md'), 'laudo do acervo', 'utf8');
    criarLaudo(outputDir, '2026-02-01_1000_torax-tc', { maskId: 'torax-tc', laudoFinalEditado: 'edição do médico' });
    const c = cfg({ masksDir, outputDir, bibliotecaBaseDir: baseDir, acervoDir });
    const { alvos } = montarAlvosReaprender(c);

    await rodarAprendizado(alvos, c);

    expect(existsSync(join(acervoDir, 'torax-tc_2026-01-01_001.md'))).toBe(true);
  });
});

describe('limparCorpusHistoricoOrfao', () => {
  it('apaga diretórios órfãos com o prefixo do corpus do histórico, sem tocar em outros', () => {
    const orfao1 = mkdtempSync(join(tmpdir(), 'aerolince-corpus-historico-'));
    const orfao2 = mkdtempSync(join(tmpdir(), 'aerolince-corpus-historico-'));
    const outroDir = mkdtempSync(join(tmpdir(), 'aerolince-outro-diretorio-'));
    writeFileSync(join(orfao1, 'x.md'), 'texto', 'utf8');
    try {
      const removidos = limparCorpusHistoricoOrfao();

      expect(removidos).toBeGreaterThanOrEqual(2);
      expect(existsSync(orfao1)).toBe(false);
      expect(existsSync(orfao2)).toBe(false);
      expect(existsSync(outroDir)).toBe(true);
    } finally {
      rmSync(outroDir, { recursive: true, force: true });
    }
  });

  it('tmpdir() sem nenhum diretório do corpus devolve 0 sem lançar', () => {
    // Melhor esforço: garante que rodar num tmpdir "limpo" (sem nenhum dir com o
    // prefixo) não lança — o teste anterior já cobre a remoção de verdade.
    for (const nome of readdirSync(tmpdir())) {
      if (nome.startsWith('aerolince-corpus-historico-')) rmSync(join(tmpdir(), nome), { recursive: true, force: true });
    }
    expect(() => limparCorpusHistoricoOrfao()).not.toThrow();
    expect(limparCorpusHistoricoOrfao()).toBe(0);
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

describe('arquivoPermitidoParaAprendizado (I5 — confinamento de caminhos na fronteira IPC)', () => {
  let acervoDir: string;
  let outroDir: string;

  beforeEach(() => {
    acervoDir = mkdtempSync(join(tmpdir(), 'aerolince-i5-acervo-'));
    outroDir = mkdtempSync(join(tmpdir(), 'aerolince-i5-fora-'));
  });

  afterEach(() => {
    rmSync(acervoDir, { recursive: true, force: true });
    rmSync(outroDir, { recursive: true, force: true });
  });

  it('permite um arquivo dentro de acervoDir', () => {
    expect(arquivoPermitidoParaAprendizado(join(acervoDir, 'torax-tc_2026-01-01_001.md'), acervoDir)).toBe(true);
  });

  it('permite um arquivo dentro de um tempdir do corpus do histórico (tmpdir()/aerolince-corpus-historico-*)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aerolince-corpus-historico-'));
    try {
      expect(arquivoPermitidoParaAprendizado(join(tempDir, 'torax-tc_000.md'), acervoDir)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('I5 (regressão obrigatória): rejeita um caminho fora de acervoDir e fora de qualquer tempdir do histórico', () => {
    expect(arquivoPermitidoParaAprendizado(join(outroDir, 'arquivo-qualquer.md'), acervoDir)).toBe(false);
  });

  it('rejeita um tempdir de OUTRO propósito (mesmo estando em tmpdir(), sem o prefixo do histórico)', () => {
    expect(arquivoPermitidoParaAprendizado(join(outroDir, 'x.md'), acervoDir)).toBe(false);
  });

  it('rejeita path traversal disfarçado (../.. a partir de dentro de acervoDir escapando para fora)', () => {
    const escapado = join(acervoDir, '..', '..', 'etc', 'passwd');
    expect(arquivoPermitidoParaAprendizado(escapado, acervoDir)).toBe(false);
  });

  it('não deixa um prefixo de diretório parecido colar (acervoDir-outro não é "dentro de" acervoDir)', () => {
    const parecido = `${acervoDir}-outro`;
    mkdirSync(parecido, { recursive: true });
    try {
      expect(arquivoPermitidoParaAprendizado(join(parecido, 'x.md'), acervoDir)).toBe(false);
    } finally {
      rmSync(parecido, { recursive: true, force: true });
    }
  });
});
