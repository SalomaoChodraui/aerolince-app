import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aplicarRascunho, descartarRascunho, lerRascunho, listarRascunhos, validarNomeRascunho } from './aplicar.js';

const MASCARA_VALIDA = `---
id: tc-cranio
modalidade: TC
nome: TC de Crânio
---
Corpo da máscara.`;

const MASCARA_INVALIDA = `---
id: TC_CRANIO_INVALIDO
modalidade: TC
---
Corpo da máscara sem "nome" e com id fora do padrão kebab-case.`;

const REGRAS = `<!-- RASCUNHO gerado automaticamente -->

## Frasário patológico
nada ainda.`;

describe('listarRascunhos', () => {
  let masksDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aprendizado-aplicar-listar-'));
  });

  afterEach(() => {
    rmSync(masksDir, { recursive: true, force: true });
  });

  it('sem pasta _rascunhos → lista vazia', () => {
    expect(listarRascunhos(masksDir)).toEqual([]);
  });

  it('classifica regras-<id>.md como tipo regras com alvo <id>', () => {
    const dir = join(masksDir, '_rascunhos');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'regras-tc-cranio.md'), REGRAS);

    expect(listarRascunhos(masksDir)).toEqual([{ arquivo: 'regras-tc-cranio.md', tipo: 'regras', alvo: 'tc-cranio' }]);
  });

  it('classifica <id>.md (sem prefixo regras-) como tipo mascara com alvo <id>', () => {
    const dir = join(masksDir, '_rascunhos');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tc-cranio.md'), MASCARA_VALIDA);

    expect(listarRascunhos(masksDir)).toEqual([{ arquivo: 'tc-cranio.md', tipo: 'mascara', alvo: 'tc-cranio' }]);
  });

  it('lista os dois tipos juntos, ordenados', () => {
    const dir = join(masksDir, '_rascunhos');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tc-cranio.md'), MASCARA_VALIDA);
    writeFileSync(join(dir, 'regras-tc-abdome.md'), REGRAS);

    expect(listarRascunhos(masksDir)).toEqual([
      { arquivo: 'regras-tc-abdome.md', tipo: 'regras', alvo: 'tc-abdome' },
      { arquivo: 'tc-cranio.md', tipo: 'mascara', alvo: 'tc-cranio' },
    ]);
  });
});

describe('aplicarRascunho', () => {
  let masksDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aprendizado-aplicar-'));
    mkdirSync(join(masksDir, '_rascunhos'), { recursive: true });
  });

  afterEach(() => {
    rmSync(masksDir, { recursive: true, force: true });
  });

  it('máscara: promove para <masksDir>/<id>.md e remove o rascunho', () => {
    writeFileSync(join(masksDir, '_rascunhos', 'tc-cranio.md'), MASCARA_VALIDA);

    const r = aplicarRascunho(masksDir, 'tc-cranio.md');

    expect(r.destino).toBe(join(masksDir, 'tc-cranio.md'));
    expect(r.backup).toBeUndefined();
    expect(readFileSync(r.destino, 'utf8')).toBe(MASCARA_VALIDA);
    expect(existsSync(join(masksDir, '_rascunhos', 'tc-cranio.md'))).toBe(false);
  });

  it('regras: promove para <masksDir>/regras/<id>.md', () => {
    writeFileSync(join(masksDir, '_rascunhos', 'regras-tc-cranio.md'), REGRAS);

    const r = aplicarRascunho(masksDir, 'regras-tc-cranio.md');

    expect(r.destino).toBe(join(masksDir, 'regras', 'tc-cranio.md'));
    expect(readFileSync(r.destino, 'utf8')).toBe(REGRAS);
    expect(existsSync(join(masksDir, '_rascunhos', 'regras-tc-cranio.md'))).toBe(false);
  });

  it('destino já existe → grava backup .bak com o conteúdo anterior antes de sobrescrever', () => {
    mkdirSync(join(masksDir, 'regras'), { recursive: true });
    writeFileSync(join(masksDir, 'regras', 'tc-cranio.md'), 'REGRAS ANTIGAS, curadoria manual.');
    writeFileSync(join(masksDir, '_rascunhos', 'regras-tc-cranio.md'), REGRAS);

    const r = aplicarRascunho(masksDir, 'regras-tc-cranio.md');

    expect(r.backup).toBe(join(masksDir, 'regras', 'tc-cranio.md.bak'));
    expect(readFileSync(r.backup!, 'utf8')).toBe('REGRAS ANTIGAS, curadoria manual.');
    expect(readFileSync(r.destino, 'utf8')).toBe(REGRAS);
  });

  it('rascunho de máscara com frontmatter inválido → erro claro, NÃO aplica (destino intacto, rascunho intacto)', () => {
    writeFileSync(join(masksDir, '_rascunhos', 'tc-cranio-invalida.md'), MASCARA_INVALIDA);

    expect(() => aplicarRascunho(masksDir, 'tc-cranio-invalida.md')).toThrow();

    expect(existsSync(join(masksDir, 'tc-cranio-invalida.md'))).toBe(false);
    expect(existsSync(join(masksDir, '_rascunhos', 'tc-cranio-invalida.md'))).toBe(true);
  });

  it('rascunho de máscara inválido não sobrescreve um destino pré-existente nem cria backup', () => {
    writeFileSync(join(masksDir, 'tc-cranio-invalida.md'), 'MÁSCARA ANTIGA VÁLIDA, não deve ser tocada.');
    writeFileSync(join(masksDir, '_rascunhos', 'tc-cranio-invalida.md'), MASCARA_INVALIDA);

    expect(() => aplicarRascunho(masksDir, 'tc-cranio-invalida.md')).toThrow();

    expect(readFileSync(join(masksDir, 'tc-cranio-invalida.md'), 'utf8')).toBe(
      'MÁSCARA ANTIGA VÁLIDA, não deve ser tocada.',
    );
    expect(existsSync(join(masksDir, 'tc-cranio-invalida.md.bak'))).toBe(false);
  });

  it('rascunho inexistente → erro claro', () => {
    expect(() => aplicarRascunho(masksDir, 'nao-existe.md')).toThrow(/n[aã]o encontrado/i);
  });

  it('regras: frontmatter não é validado (só a máscara passa pelo zod)', () => {
    writeFileSync(join(masksDir, '_rascunhos', 'regras-tc-cranio.md'), 'texto livre, sem frontmatter algum.');
    const r = aplicarRascunho(masksDir, 'regras-tc-cranio.md');
    expect(readFileSync(r.destino, 'utf8')).toBe('texto livre, sem frontmatter algum.');
  });
});

describe('descartarRascunho', () => {
  let masksDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aprendizado-descartar-'));
    mkdirSync(join(masksDir, '_rascunhos'), { recursive: true });
  });

  afterEach(() => {
    rmSync(masksDir, { recursive: true, force: true });
  });

  it('apaga o arquivo de rascunho', () => {
    const arquivo = join(masksDir, '_rascunhos', 'tc-cranio.md');
    writeFileSync(arquivo, MASCARA_VALIDA);

    descartarRascunho(masksDir, 'tc-cranio.md');

    expect(existsSync(arquivo)).toBe(false);
  });

  it('rascunho inexistente → erro claro', () => {
    expect(() => descartarRascunho(masksDir, 'nao-existe.md')).toThrow(/n[aã]o encontrado/i);
  });
});

describe('proteção contra path traversal (CRITICAL)', () => {
  let base: string;
  let masksDir: string;
  let fora: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'aprendizado-traversal-'));
    masksDir = join(base, 'biblioteca');
    mkdirSync(join(masksDir, '_rascunhos'), { recursive: true });
    // Um nível ACIMA de masksDir — alvo do PoC "../../x.txt" a partir de _rascunhos/.
    fora = join(base, 'x.txt');
    writeFileSync(fora, 'ARQUIVO EXTERNO — NÃO DEVE SER TOCADO');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('descartarRascunho("../../x.txt") lança e o arquivo externo continua existindo (reproduz o PoC do reviewer)', () => {
    expect(() => descartarRascunho(masksDir, '../../x.txt')).toThrow();
    expect(existsSync(fora)).toBe(true);
    expect(readFileSync(fora, 'utf8')).toBe('ARQUIVO EXTERNO — NÃO DEVE SER TOCADO');
  });

  it('aplicarRascunho("../../x.txt") lança e o arquivo externo continua existindo (reproduz o PoC do reviewer)', () => {
    expect(() => aplicarRascunho(masksDir, '../../x.txt')).toThrow();
    expect(existsSync(fora)).toBe(true);
    expect(readFileSync(fora, 'utf8')).toBe('ARQUIVO EXTERNO — NÃO DEVE SER TOCADO');
  });

  it('".." isolado (sem nenhuma barra) também é bloqueado — bypass de um check ingênuo por basename', () => {
    // path.basename('..') === '..', então um check só `arquivo !== basename(arquivo)` deixaria
    // passar; mas join(_rascunhos, '..') sobe direto para masksDir sem nenhum separador no input.
    expect(() => descartarRascunho(masksDir, '..')).toThrow();
    expect(() => aplicarRascunho(masksDir, '..')).toThrow();
    expect(existsSync(masksDir)).toBe(true);
  });

  it('"." isolado também é rejeitado', () => {
    expect(() => descartarRascunho(masksDir, '.')).toThrow();
    expect(() => aplicarRascunho(masksDir, '.')).toThrow();
  });

  it('nome com "\\" (barra invertida, vetor Windows) é bloqueado mesmo rodando em POSIX', () => {
    // Em POSIX, path.basename() NÃO trata "\" como separador — um check baseado só em
    // `arquivo !== basename(arquivo)` deixaria "..\\..\\x.txt" passar (basename devolve a
    // própria string inalterada). O guard precisa rejeitar "\" explicitamente por conteúdo.
    const comBarraInvertida = '..\\..\\x.txt';
    expect(() => descartarRascunho(masksDir, comBarraInvertida)).toThrow();
    expect(() => aplicarRascunho(masksDir, comBarraInvertida)).toThrow();
    expect(existsSync(fora)).toBe(true);
    expect(readFileSync(fora, 'utf8')).toBe('ARQUIVO EXTERNO — NÃO DEVE SER TOCADO');
  });

  it('validarNomeRascunho, exportada para reuso defensivo, rejeita "/" e "\\" diretamente', () => {
    expect(() => validarNomeRascunho('a/b.md')).toThrow();
    expect(() => validarNomeRascunho('a\\b.md')).toThrow();
    expect(() => validarNomeRascunho('regras-tc-cranio.md')).not.toThrow();
  });
});

describe('lerRascunho', () => {
  let masksDir: string;

  beforeEach(() => {
    masksDir = mkdtempSync(join(tmpdir(), 'aprendizado-ler-'));
    mkdirSync(join(masksDir, '_rascunhos'), { recursive: true });
  });

  afterEach(() => {
    rmSync(masksDir, { recursive: true, force: true });
  });

  it('nome válido → devolve o conteúdo do rascunho sem promovê-lo nem descartá-lo', () => {
    writeFileSync(join(masksDir, '_rascunhos', 'tc-cranio.md'), MASCARA_VALIDA);

    expect(lerRascunho(masksDir, 'tc-cranio.md')).toBe(MASCARA_VALIDA);
    // não promove nem descarta — o rascunho continua exatamente onde estava
    expect(existsSync(join(masksDir, '_rascunhos', 'tc-cranio.md'))).toBe(true);
    expect(existsSync(join(masksDir, 'tc-cranio.md'))).toBe(false);
  });

  it('"../x" lança (mesmo guard de traversal de aplicarRascunho/descartarRascunho)', () => {
    expect(() => lerRascunho(masksDir, '../x')).toThrow();
  });

  it('rascunho inexistente → erro claro', () => {
    expect(() => lerRascunho(masksDir, 'nao-existe.md')).toThrow(/n[aã]o encontrado/i);
  });
});
