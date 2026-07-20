import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => {
      const t = b.toString();
      if (!t.startsWith('enc:')) throw new Error('blob inválido');
      return t.slice(4);
    }),
  },
}));

import { safeStorage } from 'electron';
import { salvarChave, statusChaves, testarChave } from './secrets.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aerolince-secrets-'));
  delete process.env['MOONSHOT_API_KEY'];
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
});

describe('cofre honesto (P0-06)', () => {
  it('roundtrip: salvar → status ok', () => {
    salvarChave(root, 'MOONSHOT_API_KEY', 'sk-teste');
    const s = statusChaves(root);
    expect(s.cofreDisponivel).toBe(true);
    expect(s.chaves.MOONSHOT_API_KEY).toBe('ok');
    expect(process.env['MOONSHOT_API_KEY']).toBe('sk-teste');
  });

  it('salvar com cofre indisponível LANÇA (não deleta silenciosamente)', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(() => salvarChave(root, 'MOONSHOT_API_KEY', 'sk-teste')).toThrow(/cofre/);
  });

  it('blob indecifrável aparece como invalida, não como configurada', () => {
    salvarChave(root, 'MOONSHOT_API_KEY', 'sk-teste');
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('corrompido');
    });
    delete process.env['MOONSHOT_API_KEY'];
    expect(statusChaves(root).chaves.MOONSHOT_API_KEY).toBe('invalida');
  });

  it('valor vazio remove a chave → ausente', () => {
    salvarChave(root, 'MOONSHOT_API_KEY', 'sk-teste');
    salvarChave(root, 'MOONSHOT_API_KEY', '');
    expect(statusChaves(root).chaves.MOONSHOT_API_KEY).toBe('ausente');
    expect(process.env['MOONSHOT_API_KEY']).toBeUndefined();
  });
});

describe('testarChave (SECRET-01)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env['MOONSHOT_API_KEY'];
  });

  it('sem chave em process.env → falha sem chamar fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await testarChave('MOONSHOT_API_KEY');
    expect(r).toEqual({ ok: false, erro: 'chave não configurada' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('200 → chave válida', async () => {
    process.env['MOONSHOT_API_KEY'] = 'sk-teste';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const r = await testarChave('MOONSHOT_API_KEY');
    expect(r).toEqual({ ok: true });
  });

  it('401 → chave inválida ou revogada', async () => {
    process.env['MOONSHOT_API_KEY'] = 'sk-teste';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const r = await testarChave('MOONSHOT_API_KEY');
    expect(r).toEqual({ ok: false, erro: 'chave inválida ou revogada' });
  });

  it('403 → chave inválida ou revogada', async () => {
    process.env['MOONSHOT_API_KEY'] = 'sk-teste';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const r = await testarChave('MOONSHOT_API_KEY');
    expect(r).toEqual({ ok: false, erro: 'chave inválida ou revogada' });
  });

  it('500/outro status → não pode ler como válida, expõe o status', async () => {
    process.env['MOONSHOT_API_KEY'] = 'sk-teste';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const r = await testarChave('MOONSHOT_API_KEY');
    expect(r).toEqual({ ok: false, erro: 'serviço respondeu 500' });
  });

  it('rejeição do fetch (erro de rede/AbortError) → sem conexão com o serviço', async () => {
    process.env['MOONSHOT_API_KEY'] = 'sk-teste';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('falha de rede')));
    const r = await testarChave('MOONSHOT_API_KEY');
    expect(r).toEqual({ ok: false, erro: 'sem conexão com o serviço' });
  });

  it('rejeição do fetch não vaza o timer de abort (fix do vazamento, T10)', async () => {
    vi.useFakeTimers();
    process.env['MOONSHOT_API_KEY'] = 'sk-teste';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('falha de rede')));
    const r = await testarChave('MOONSHOT_API_KEY');
    expect(r).toEqual({ ok: false, erro: 'sem conexão com o serviço' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
