import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from './config/schema.js';
import { loadRegras } from './contexto.js';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'aero-base-'));
  const medico = mkdtempSync(join(tmpdir(), 'aero-med-'));
  mkdirSync(join(base, 'regras'), { recursive: true });
  mkdirSync(join(base, 'frasario'), { recursive: true });
  mkdirSync(join(medico, 'regras'), { recursive: true });
  mkdirSync(join(medico, 'frasario'), { recursive: true });
  const config = ConfigSchema.parse({
    masksDir: medico, bibliotecaBaseDir: base, acervoDir: '/x', profilesDir: medico, outputDir: medico, stt: {}, llm: {},
  });
  return { base, medico, config };
}

describe('loadRegras em camadas', () => {
  it('gerais.md do médico substitui o da base; específica cai para a base', () => {
    const { base, medico, config } = setup();
    writeFileSync(join(base, 'regras', 'gerais.md'), 'GERAIS BASE', 'utf8');
    writeFileSync(join(medico, 'regras', 'gerais.md'), 'GERAIS DO MÉDICO', 'utf8');
    writeFileSync(join(base, 'regras', 'tc-cranio.md'), 'CRANIO BASE', 'utf8');
    const r = loadRegras(config, 'tc-cranio')!;
    expect(r).toContain('GERAIS DO MÉDICO');
    expect(r).not.toContain('GERAIS BASE');
    expect(r).toContain('CRANIO BASE');
  });

  it('frasário: união com o médico vencendo por nome de arquivo', () => {
    const { base, medico, config } = setup();
    writeFileSync(join(base, 'frasario', 'a.md'), '---\naplica_a: []\n---\nFRASE BASE A', 'utf8');
    writeFileSync(join(base, 'frasario', 'b.md'), '---\naplica_a: []\n---\nFRASE BASE B', 'utf8');
    writeFileSync(join(medico, 'frasario', 'a.md'), '---\naplica_a: []\n---\nFRASE MEDICO A', 'utf8');
    const r = loadRegras(config, 'tc-cranio')!;
    expect(r).toContain('FRASE MEDICO A');
    expect(r).not.toContain('FRASE BASE A');
    expect(r).toContain('FRASE BASE B');
  });

  it('frasário: cópia da base com corpo idêntico ao do médico sob OUTRO nome sai — corpo 1 vez, citando o arquivo do médico', () => {
    const { base, medico, config } = setup();
    const corpo = 'FRASE DUPLICADA C';
    writeFileSync(join(base, 'frasario', 'achados-x.md'), `---\naplica_a: []\n---\n${corpo}`, 'utf8');
    writeFileSync(join(medico, 'frasario', 'antigo-nome.md'), `---\naplica_a: []\n---\n${corpo}`, 'utf8');
    const r = loadRegras(config, 'tc-cranio')!;
    expect(r.split(corpo).length - 1).toBe(1);
    expect(r).toContain('(antigo-nome.md)');
    expect(r).not.toContain('(achados-x.md)');
  });

  it('frasário: corpos DIFERENTES sob nomes diferentes → ambos entram', () => {
    const { base, medico, config } = setup();
    writeFileSync(join(base, 'frasario', 'achados-x.md'), '---\naplica_a: []\n---\nCORPO DA BASE', 'utf8');
    writeFileSync(join(medico, 'frasario', 'antigo-nome.md'), '---\naplica_a: []\n---\nCORPO DO MEDICO', 'utf8');
    const r = loadRegras(config, 'tc-cranio')!;
    expect(r).toContain('CORPO DA BASE');
    expect(r).toContain('CORPO DO MEDICO');
  });

  it('aplica_a continua filtrando por máscara', () => {
    const { base, config } = setup();
    writeFileSync(join(base, 'frasario', 'so-torax.md'), '---\naplica_a: [tc-torax]\n---\nSO TORAX', 'utf8');
    expect(loadRegras(config, 'tc-cranio') ?? '').not.toContain('SO TORAX');
    expect(loadRegras(config, 'tc-torax')!).toContain('SO TORAX');
  });
});

describe('loadRegras — pares de síntese da conclusão (regras/sintese-<maskId>.md)', () => {
  it('sintese-<id>.md do médico vence o da base (mesma precedência por arquivo das regras)', () => {
    const { base, medico, config } = setup();
    writeFileSync(join(base, 'regras', 'sintese-tc-abdome.md'), '- corpo: X base\n  conclusão: Y base', 'utf8');
    writeFileSync(join(medico, 'regras', 'sintese-tc-abdome.md'), '- corpo: X medico\n  conclusão: Y medico', 'utf8');
    const r = loadRegras(config, 'tc-abdome')!;
    expect(r).toContain('Y medico');
    expect(r).not.toContain('Y base');
  });

  it('só na base → cai para a base; injeta com o cabeçalho próprio de PARES DE SÍNTESE', () => {
    const { base, config } = setup();
    writeFileSync(join(base, 'regras', 'sintese-tc-abdome.md'), '- corpo: X\n  conclusão: Y', 'utf8');
    const r = loadRegras(config, 'tc-abdome')!;
    expect(r).toContain('PARES DE SÍNTESE DA CONCLUSÃO');
    expect(r).toContain('- corpo: X');
  });

  it('posição: depois das regras da máscara e antes do frasário', () => {
    const { base, config } = setup();
    writeFileSync(join(base, 'regras', 'tc-abdome.md'), 'REGRAS DA MASCARA', 'utf8');
    writeFileSync(join(base, 'regras', 'sintese-tc-abdome.md'), 'PARES AQUI', 'utf8');
    writeFileSync(join(base, 'frasario', 'a.md'), '---\naplica_a: []\n---\nFRASE A', 'utf8');
    const r = loadRegras(config, 'tc-abdome')!;
    expect(r.indexOf('REGRAS DA MASCARA')).toBeLessThan(r.indexOf('PARES AQUI'));
    expect(r.indexOf('PARES AQUI')).toBeLessThan(r.indexOf('FRASE A'));
  });

  it('ausente nas duas camadas não quebra nem injeta o cabeçalho', () => {
    const { base, config } = setup();
    writeFileSync(join(base, 'regras', 'gerais.md'), 'GERAIS', 'utf8');
    const r = loadRegras(config, 'tc-abdome')!;
    expect(r).toContain('GERAIS');
    expect(r).not.toContain('PARES DE SÍNTESE DA CONCLUSÃO');
  });

  it('sintese de OUTRA máscara não entra (arquivo é por exame)', () => {
    const { base, config } = setup();
    writeFileSync(join(base, 'regras', 'sintese-tc-torax.md'), 'PARES DO TORAX', 'utf8');
    expect(loadRegras(config, 'tc-abdome') ?? '').not.toContain('PARES DO TORAX');
  });
});
