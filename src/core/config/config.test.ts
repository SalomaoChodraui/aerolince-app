import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from './schema.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aerolince-config-'));
});

describe('loadConfig com recuperação', () => {
  it('sem arquivo → defaults', () => {
    const c = loadConfig(root);
    expect(c.masksDir.endsWith('biblioteca-mascaras')).toBe(true);
    expect(c.perfilPadrao).toBe('padrao');
  });

  it('JSON corrompido não impede o boot: preserva o arquivo e usa defaults', () => {
    writeFileSync(join(root, 'laudo.config.json'), '{{{ nem json', 'utf8');
    const c = loadConfig(root);
    expect(c.perfilPadrao).toBe('padrao');
    const arquivos = readdirSync(root);
    expect(arquivos.some((f) => f.startsWith('laudo.config.corrompido-'))).toBe(true);
    expect(arquivos.includes('laudo.config.json')).toBe(false);
  });

  it('overlay que viola o schema também cai em recuperação', () => {
    writeFileSync(join(root, 'laudo.config.json'), JSON.stringify({ ui: { tema: 'roxo' } }), 'utf8');
    const c = loadConfig(root);
    expect(c.ui.tema).toBe('auto');
    expect(readdirSync(root).some((f) => f.startsWith('laudo.config.corrompido-'))).toBe(true);
  });

  it('falha ao preservar o corrompido (ex.: diretório somente leitura) não impede o boot', () => {
    writeFileSync(join(root, 'laudo.config.json'), '{{{ nem json', 'utf8');
    chmodSync(root, 0o555); // impede rename/create no diretório (permissão/disco simulados)
    try {
      const c = loadConfig(root);
      expect(c.perfilPadrao).toBe('padrao');
    } finally {
      chmodSync(root, 0o755); // restaura para permitir limpeza do diretório temporário
    }
  });

  it('backup .bak assume quando o principal corrompe', () => {
    saveConfig(root, { perfilPadrao: 'meu-estilo' });
    saveConfig(root, { perfilPadrao: 'meu-estilo-2' }); // gera .bak com meu-estilo
    writeFileSync(join(root, 'laudo.config.json'), 'corrompido', 'utf8');
    const c = loadConfig(root);
    expect(c.perfilPadrao).toBe('meu-estilo'); // veio do .bak
    expect(readFileSync(join(root, 'laudo.config.json'), 'utf8')).toContain('meu-estilo');
  });

  it('config antiga sem os campos novos de stt ganha defaults', () => {
    writeFileSync(
      join(root, 'laudo.config.json'),
      JSON.stringify({ schemaVersion: 1, stt: { model: 'gpt-4o-transcribe' } }),
      'utf8',
    );
    const c = loadConfig(root);
    expect(c.stt.captura).toBe('segmentada');
    expect(c.stt.pausaMs).toBe(1200);
    expect(c.stt.model).toBe('gpt-4o-transcribe');
  });
});

describe('saveConfig atômico', () => {
  it('roundtrip com schemaVersion no overlay', () => {
    saveConfig(root, { perfilPadrao: 'x' });
    expect(loadConfig(root).perfilPadrao).toBe('x');
    const bruto = JSON.parse(readFileSync(join(root, 'laudo.config.json'), 'utf8'));
    expect(bruto.schemaVersion).toBe(1);
  });

  it('patch inválido lança e NÃO toca o arquivo em disco', () => {
    saveConfig(root, { perfilPadrao: 'antes' });
    const antes = readFileSync(join(root, 'laudo.config.json'), 'utf8');
    expect(() => saveConfig(root, { ui: { tema: 'roxo' } })).toThrow();
    expect(readFileSync(join(root, 'laudo.config.json'), 'utf8')).toBe(antes);
  });

  it('merge aninhado de ui preserva os demais campos', () => {
    saveConfig(root, { ui: { tema: 'escuro' } });
    saveConfig(root, { ui: { opacidadeBalao: 0.5 } });
    const c = loadConfig(root);
    expect(c.ui.tema).toBe('escuro');
    expect(c.ui.opacidadeBalao).toBe(0.5);
  });

  it('não deixa arquivo temporário para trás', () => {
    saveConfig(root, { perfilPadrao: 'x' });
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('pausaMs fora do intervalo é rejeitado', () => {
    expect(() => saveConfig(root, { stt: { pausaMs: 100 } })).toThrow();
  });

  it('merge raso de stt preserva campos não enviados', () => {
    saveConfig(root, { stt: { glossario: ['esteatose'] } });
    saveConfig(root, { stt: { pausaMs: 2000 } });
    const c = loadConfig(root);
    expect(c.stt.pausaMs).toBe(2000);
    expect(c.stt.glossario).toEqual(['esteatose']);
    expect(c.stt.captura).toBe('segmentada');
  });
});
