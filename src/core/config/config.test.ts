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

  it('opacidadeBalao 0.05 (mínimo) é aceito', () => {
    saveConfig(root, { ui: { opacidadeBalao: 0.05 } });
    expect(loadConfig(root).ui.opacidadeBalao).toBe(0.05);
  });

  it('opacidadeBalao 0.04 (abaixo do mínimo) é rejeitado', () => {
    expect(() => saveConfig(root, { ui: { opacidadeBalao: 0.04 } })).toThrow();
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

describe('progresso do onboarding (config)', () => {
  it('sem arquivo → defaults (passo 0, não importado, versão 1)', () => {
    const c = loadConfig(root);
    expect(c.onboarding).toEqual({ versao: 1, passo: 0, acervoImportado: false });
  });

  it('config antiga sem o bloco onboarding ganha defaults', () => {
    writeFileSync(
      join(root, 'laudo.config.json'),
      JSON.stringify({ schemaVersion: 1, ui: { tema: 'escuro' } }),
      'utf8',
    );
    const c = loadConfig(root);
    expect(c.onboarding).toEqual({ versao: 1, passo: 0, acervoImportado: false });
  });

  it('merge raso de onboarding preserva campos não enviados', () => {
    saveConfig(root, { onboarding: { passo: 3 } });
    saveConfig(root, { onboarding: { acervoImportado: true } });
    const c = loadConfig(root);
    expect(c.onboarding.passo).toBe(3);
    expect(c.onboarding.acervoImportado).toBe(true);
    expect(c.onboarding.versao).toBe(1);
  });

  it('merge raso de onboarding preserva o resto ao salvar outra seção', () => {
    saveConfig(root, { onboarding: { passo: 5 } });
    saveConfig(root, { ui: { tema: 'escuro' } });
    const c = loadConfig(root);
    expect(c.onboarding.passo).toBe(5);
    expect(c.ui.tema).toBe('escuro');
  });
});

describe('formato do laudo (config `laudo`)', () => {
  it('defaults preservam o comportamento atual: por-bloco, Indicação/Observação inativas', () => {
    const c = loadConfig(root);
    expect(c.laudo.paragrafo).toBe('por-bloco');
    expect(c.laudo.porExame).toEqual({});
    expect(c.laudo.secoes.map((s) => s.id)).toEqual([
      'titulo',
      'tecnica',
      'indicacao',
      'achados',
      'achados-adicionais',
      'conclusao',
      'observacao',
    ]);
    expect(c.laudo.secoes.find((s) => s.id === 'achados')).toEqual({ id: 'achados', rotulo: 'Análise:', ativa: true });
    expect(c.laudo.secoes.find((s) => s.id === 'indicacao')!.ativa).toBe(false);
    expect(c.laudo.secoes.find((s) => s.id === 'observacao')!.ativa).toBe(false);
  });

  it('config antiga sem o bloco laudo ganha defaults', () => {
    writeFileSync(
      join(root, 'laudo.config.json'),
      JSON.stringify({ schemaVersion: 1, ui: { tema: 'escuro' } }),
      'utf8',
    );
    expect(loadConfig(root).laudo.paragrafo).toBe('por-bloco');
  });

  it('merge raso de laudo preserva campos não enviados (a preferência persiste)', () => {
    saveConfig(root, { laudo: { paragrafo: 'corrido' } });
    saveConfig(root, {
      laudo: { porExame: { 'tc-cranio': { secoes: [{ id: 'conclusao', rotulo: 'Opinião:' }] } } },
    });
    const c = loadConfig(root);
    expect(c.laudo.paragrafo).toBe('corrido');
    expect(c.laudo.porExame['tc-cranio']!.secoes![0]).toEqual({ id: 'conclusao', rotulo: 'Opinião:' });
  });

  it('merge raso preserva laudo ao salvar outra seção', () => {
    saveConfig(root, { laudo: { paragrafo: 'corrido' } });
    saveConfig(root, { ui: { tema: 'escuro' } });
    expect(loadConfig(root).laudo.paragrafo).toBe('corrido');
  });

  it('paragrafo inválido é rejeitado sem tocar o arquivo', () => {
    expect(() => saveConfig(root, { laudo: { paragrafo: 'zigue-zague' } })).toThrow();
  });
});

describe('retenção do histórico (config)', () => {
  it('config antiga sem o bloco historico ganha default retencaoDias 0', () => {
    writeFileSync(
      join(root, 'laudo.config.json'),
      JSON.stringify({ schemaVersion: 1, ui: { tema: 'escuro' } }),
      'utf8',
    );
    expect(loadConfig(root).historico.retencaoDias).toBe(0);
  });

  it('merge raso preserva historico ao salvar outra seção', () => {
    saveConfig(root, { historico: { retencaoDias: 30 } });
    saveConfig(root, { ui: { tema: 'escuro' } });
    const c = loadConfig(root);
    expect(c.historico.retencaoDias).toBe(30);
    expect(c.ui.tema).toBe('escuro');
  });

  it('retencaoDias 5000 (acima do máximo de 3650) é rejeitado', () => {
    expect(() => saveConfig(root, { historico: { retencaoDias: 5000 } })).toThrow();
  });
});
