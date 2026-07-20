import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 0 })),
    showErrorBox: vi.fn(),
  },
}));

const { SpoolSessao, listarSessoesOrfas } = await import('./spool.js');
const { recuperarSpoolOrfao } = await import('./recovery.js');
const { dialog } = await import('electron');

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rec-')); vi.clearAllMocks(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const pcm = (n: number) => Buffer.from(new Int16Array(n).fill(3).buffer);

describe('recuperarSpoolOrfao', () => {
  it('sem órfãs → nem diálogo nem transcrição', async () => {
    const transcrever = vi.fn();
    await recuperarSpoolOrfao(root, transcrever);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(transcrever).not.toHaveBeenCalled();
  });

  it('órfã com >48h é apagada em silêncio', async () => {
    const spool = SpoolSessao.criar(root)!;
    const antes = (Date.now() - 72 * 3600_000) / 1000;
    utimesSync(spool.dir, antes, antes);
    await recuperarSpoolOrfao(root, vi.fn());
    expect(listarSessoesOrfas(root)).toHaveLength(0);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('órfã sem segmentos → descartada em silêncio, sem diálogo', async () => {
    // Sessão que falhou no guard "sem áudio" deixa spool órfão vazio; oferecer
    // diálogo mentiria "~1 min de fala" e Transcrever cairia no guard de novo.
    SpoolSessao.criar(root)!; // sem appendSegmento → 0 segmentos
    const transcrever = vi.fn();
    await recuperarSpoolOrfao(root, transcrever);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(transcrever).not.toHaveBeenCalled();
    expect(listarSessoesOrfas(root)).toHaveLength(0);
  });

  it('Transcrever agora → callback recebe os segmentos e o spool é apagado', async () => {
    const spool = SpoolSessao.criar(root)!;
    spool.appendSegmento(pcm(1600), 100);
    spool.appendSegmento(pcm(800), 50);
    // Params tipados: dá assinatura ao mock p/ o strict + noUncheckedIndexedAccess
    // destructurar mock.calls[0] (senão vira `[] | undefined`).
    const transcrever = vi.fn(async (_segmentos: Int16Array[], _speechMs: number) => {});
    await recuperarSpoolOrfao(root, transcrever);
    expect(transcrever).toHaveBeenCalledTimes(1);
    const [segs, speechMs] = transcrever.mock.calls[0]!;
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(1600);
    expect(speechMs).toBe(150);
    expect(listarSessoesOrfas(root)).toHaveLength(0);
  });

  it('Descartar → apaga sem transcrever', async () => {
    SpoolSessao.criar(root)!.appendSegmento(pcm(100), 10);
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1 } as never);
    const transcrever = vi.fn();
    await recuperarSpoolOrfao(root, transcrever);
    expect(transcrever).not.toHaveBeenCalled();
    expect(listarSessoesOrfas(root)).toHaveLength(0);
  });

  it('falha na transcrição preserva o spool para o próximo boot', async () => {
    SpoolSessao.criar(root)!.appendSegmento(pcm(100), 10);
    const transcrever = vi.fn(async () => { throw new Error('rede caiu'); });
    await expect(recuperarSpoolOrfao(root, transcrever)).rejects.toThrow('rede caiu');
    expect(listarSessoesOrfas(root)).toHaveLength(1);
  });

  it('só a mais recente é oferecida; demais órfãs são apagadas', async () => {
    const velha = SpoolSessao.criar(root)!;
    const antes = (Date.now() - 3600_000) / 1000;
    utimesSync(velha.dir, antes, antes);
    SpoolSessao.criar(root)!.appendSegmento(pcm(100), 10);
    await recuperarSpoolOrfao(root, vi.fn(async () => {}));
    expect(listarSessoesOrfas(root)).toHaveLength(0);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });
});
