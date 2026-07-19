import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { salvarChave, statusChaves } from './secrets.js';

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
