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
