import { describe, expect, it } from 'vitest';
import { avisosDeCaptura, contarPalavras } from './avisos-captura.js';

// Caso real do smoke test (2026-08): capturedMs 57248, speechMs 10720 (ratio 0,187),
// transcript de 13 palavras, blocosAlterados: [] — laudo saiu = máscara normal, SEM AVISO.
describe('avisosDeCaptura', () => {
  it('zero blocos + 13 palavras → aviso de ditado sem alteração', () => {
    const avisos = avisosDeCaptura({ palavrasDitadas: 13, blocosAlterados: [] });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('você ditou 13 palavras');
    expect(avisos[0]).toContain('NENHUMA alteração foi aplicada');
  });

  it('zero blocos + 3 palavras ("tomografia de crânio normal" é ditado legítimo de exame normal) → sem aviso', () => {
    expect(avisosDeCaptura({ palavrasDitadas: 3, blocosAlterados: [] })).toEqual([]);
  });

  it('limiar: 8 palavras já dispara o aviso (inclusive)', () => {
    expect(avisosDeCaptura({ palavrasDitadas: 8, blocosAlterados: [] })).toHaveLength(1);
  });

  it('limiar: 7 palavras ainda não dispara', () => {
    expect(avisosDeCaptura({ palavrasDitadas: 7, blocosAlterados: [] })).toEqual([]);
  });

  it('blocos alterados + speechRatio 0,18 (com telemetria) → só o aviso de fala não captada', () => {
    const avisos = avisosDeCaptura({
      palavrasDitadas: 20,
      blocosAlterados: ['torax'],
      audio: { capturedMs: 57248, speechMs: 10720, speechRatio: 10720 / 57248 },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('boa parte da sua fala não foi captada');
    expect(avisos[0]).toContain('11s de 57s'); // X/Y em segundos inteiros
  });

  it('speechRatio 0,6 → sem aviso de fala não captada', () => {
    const avisos = avisosDeCaptura({
      palavrasDitadas: 20,
      blocosAlterados: ['torax'],
      audio: { capturedMs: 57248, speechMs: 34349, speechRatio: 0.6 },
    });
    expect(avisos).toEqual([]);
  });

  it('capturedMs no limite (15000, não é > 15000) → sem aviso mesmo com ratio baixo', () => {
    const avisos = avisosDeCaptura({
      palavrasDitadas: 20,
      blocosAlterados: ['torax'],
      audio: { capturedMs: 15000, speechMs: 1000, speechRatio: 1000 / 15000 },
    });
    expect(avisos).toEqual([]);
  });

  it('sem telemetria (fluxo de texto/clássico) → só avalia a regra (a)', () => {
    expect(avisosDeCaptura({ palavrasDitadas: 20, blocosAlterados: ['torax'] })).toEqual([]);
    expect(avisosDeCaptura({ palavrasDitadas: 13, blocosAlterados: [] })).toHaveLength(1);
  });

  it('as duas condições podem coexistir', () => {
    const avisos = avisosDeCaptura({
      palavrasDitadas: 13,
      blocosAlterados: [],
      audio: { capturedMs: 57248, speechMs: 10720, speechRatio: 10720 / 57248 },
    });
    expect(avisos).toHaveLength(2);
  });

  it('nem 8 palavras nem alteração ausente: com blocos alterados, não avisa mesmo com poucas palavras', () => {
    expect(avisosDeCaptura({ palavrasDitadas: 2, blocosAlterados: ['torax'] })).toEqual([]);
  });

  it('1 segmento recusado → aviso no singular', () => {
    const avisos = avisosDeCaptura({ palavrasDitadas: 20, blocosAlterados: ['torax'], segmentosRecusados: 1 });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('1 trecho do seu ditado não chegou à transcrição');
  });

  it('vários segmentos recusados → aviso no plural', () => {
    const avisos = avisosDeCaptura({ palavrasDitadas: 20, blocosAlterados: ['torax'], segmentosRecusados: 3 });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('3 trechos do seu ditado não chegaram à transcrição');
  });

  it('segmentosRecusados 0 ou ausente → sem aviso', () => {
    expect(avisosDeCaptura({ palavrasDitadas: 20, blocosAlterados: ['torax'], segmentosRecusados: 0 })).toEqual([]);
    expect(avisosDeCaptura({ palavrasDitadas: 20, blocosAlterados: ['torax'] })).toEqual([]);
  });

  it('as três condições podem coexistir', () => {
    const avisos = avisosDeCaptura({
      palavrasDitadas: 13,
      blocosAlterados: [],
      audio: { capturedMs: 57248, speechMs: 10720, speechRatio: 10720 / 57248 },
      segmentosRecusados: 2,
    });
    expect(avisos).toHaveLength(3);
  });
});

describe('contarPalavras', () => {
  it('conta tokens separados por espaço', () => {
    expect(contarPalavras('tomografia de crânio normal')).toBe(4);
  });

  it('ignora espaços múltiplos e nas pontas', () => {
    expect(contarPalavras('  essa   tomo   é  ')).toBe(3);
  });

  it('string vazia conta zero', () => {
    expect(contarPalavras('')).toBe(0);
    expect(contarPalavras('   ')).toBe(0);
  });
});
