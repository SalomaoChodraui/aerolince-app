import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
  },
}));

const { SessaoAudio } = await import('./sessao.js');
const { listarSessoesOrfas } = await import('./spool.js');

let root: string;
let sessao: InstanceType<typeof SessaoAudio>;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sessao-')); sessao = new SessaoAudio(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const pcmBuf = (n: number) => Buffer.from(new Int16Array(n).fill(7).buffer);

describe('SessaoAudio', () => {
  it('ciclo completo: iniciar → 3 segmentos → finalizar', () => {
    expect(sessao.iniciar(root)).toEqual({ ok: true, semCofre: false });
    for (let i = 0; i < 3; i++) expect(sessao.receberSegmento(pcmBuf(1600), 100).ok).toBe(true);
    const fin = sessao.finalizar()!;
    expect(fin.segmentos).toHaveLength(3);
    expect(fin.speechMs).toBe(300);
    expect(fin.capturedMs).toBeGreaterThanOrEqual(0); // relógio de parede do teste, não a soma da fala
    expect(fin.spool).not.toBeNull();
  });

  it('só uma sessão por vez', () => {
    sessao.iniciar(root);
    expect(sessao.iniciar(root).ok).toBe(false);
  });

  it('segmento sem sessão ativa é recusado', () => {
    expect(sessao.receberSegmento(pcmBuf(100), 10).ok).toBe(false);
  });

  it('segmento gigante é recusado', () => {
    sessao.iniciar(root);
    expect(sessao.receberSegmento(Buffer.alloc(5 * 1024 * 1024), 10).ok).toBe(false);
  });

  it('cancelar limpa o spool e permite nova sessão', () => {
    sessao.iniciar(root);
    sessao.receberSegmento(pcmBuf(1600), 100);
    sessao.cancelar();
    expect(listarSessoesOrfas(root)).toHaveLength(0);
    expect(sessao.iniciar(root).ok).toBe(true);
  });

  it('finalizar sem sessão → null', () => {
    expect(sessao.finalizar()).toBeNull();
  });
});
