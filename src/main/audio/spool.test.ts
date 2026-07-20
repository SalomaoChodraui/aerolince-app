import { mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
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

const { SpoolSessao, apagarSessoesAntigas, listarSessoesOrfas } = await import('./spool.js');
const { safeStorage } = await import('electron');

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'spool-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true); });

describe('SpoolSessao', () => {
  it('roundtrip: criar → append → abrir → listarSegmentos decifra', () => {
    const spool = SpoolSessao.criar(root)!;
    const pcm = Buffer.from('fala-em-pcm-1234');
    spool.appendSegmento(pcm, 750);
    spool.appendSegmento(Buffer.from('outro-trecho'), 500);

    const reaberto = SpoolSessao.abrir(spool.dir)!;
    const segs = reaberto.listarSegmentos();
    expect(segs).toHaveLength(2);
    expect(segs[0]!.equals(pcm)).toBe(true);
    expect(reaberto.meta.segmentos.map((s) => s.durationMs)).toEqual([750, 500]);
  });

  it('nada em claro no disco', () => {
    const spool = SpoolSessao.criar(root)!;
    spool.appendSegmento(Buffer.from('CONTEUDO-SENSIVEL'), 100);
    const arquivo = readFileSync(join(spool.dir, 'seg-000.bin'));
    expect(arquivo.includes(Buffer.from('CONTEUDO-SENSIVEL'))).toBe(false);
  });

  it('sem cofre → criar devolve null (nunca spool em claro)', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(SpoolSessao.criar(root)).toBeNull();
  });

  it('manifest corrompido → abrir devolve null', () => {
    const spool = SpoolSessao.criar(root)!;
    rmSync(join(spool.dir, 'manifest.json'));
    expect(SpoolSessao.abrir(spool.dir)).toBeNull();
  });

  it('descartar remove o diretório', () => {
    const spool = SpoolSessao.criar(root)!;
    spool.descartar();
    expect(listarSessoesOrfas(root)).toHaveLength(0);
  });
});

describe('órfãs e expiração', () => {
  it('lista sessões existentes como órfãs', () => {
    SpoolSessao.criar(root);
    expect(listarSessoesOrfas(root)).toHaveLength(1);
  });

  it('apagarSessoesAntigas remove só as vencidas', () => {
    const velha = SpoolSessao.criar(root)!;
    const antes = (Date.now() - 72 * 3600_000) / 1000;
    utimesSync(velha.dir, antes, antes);
    SpoolSessao.criar(root);
    apagarSessoesAntigas(root, 48 * 3600_000);
    expect(listarSessoesOrfas(root)).toHaveLength(1);
  });
});
