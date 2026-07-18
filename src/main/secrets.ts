/**
 * Chaves de API guardadas com criptografia do SO (safeStorage: Keychain no mac,
 * DPAPI no Windows). Carregadas no boot e injetadas em process.env — o core
 * continua lendo process.env sem saber da existência deste módulo.
 * Migra automaticamente chaves que já estavam num .env legado.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';

export type NomeChave = 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'MOONSHOT_API_KEY';
const CHAVES: NomeChave[] = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MOONSHOT_API_KEY'];

function arq(root: string): string {
  return join(root, 'secrets.enc.json');
}

function lerCofre(root: string): Record<string, string> {
  const p = arq(root);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/** Grava uma chave criptografada (valor vazio remove). */
export function salvarChave(root: string, nome: NomeChave, valor: string): void {
  const cofre = lerCofre(root);
  if (valor.trim() && safeStorage.isEncryptionAvailable()) {
    cofre[nome] = safeStorage.encryptString(valor.trim()).toString('base64');
    process.env[nome] = valor.trim();
  } else {
    delete cofre[nome];
    delete process.env[nome];
  }
  writeFileSync(arq(root), JSON.stringify(cofre, null, 2), 'utf8');
}

/** Carrega o cofre e injeta em process.env. Importa (sem apagar) de um .env se preciso. */
export function carregarChaves(root: string): void {
  const cofre = lerCofre(root);
  for (const nome of CHAVES) {
    if (cofre[nome] && safeStorage.isEncryptionAvailable()) {
      try {
        process.env[nome] = safeStorage.decryptString(Buffer.from(cofre[nome]!, 'base64'));
      } catch {
        /* chave corrompida — ignora, médico reconfigura */
      }
    }
  }
  // Importa de um .env existente para o cofre — NÃO altera o .env (a CLI ainda o usa)
  const envPath = join(root, '.env');
  if (existsSync(envPath) && safeStorage.isEncryptionAvailable()) {
    const linhas = readFileSync(envPath, 'utf8').split('\n');
    for (const nome of CHAVES) {
      if (process.env[nome]) continue;
      const valor = linhas.find((l) => l.startsWith(`${nome}=`))?.slice(nome.length + 1).trim();
      if (valor) salvarChave(root, nome, valor);
    }
  }
}

/** Estado das chaves (sem revelar o valor) — para a tela de configurações. */
export function statusChaves(root: string): Record<NomeChave, boolean> {
  const cofre = lerCofre(root);
  return {
    ANTHROPIC_API_KEY: Boolean(cofre.ANTHROPIC_API_KEY || process.env['ANTHROPIC_API_KEY']),
    OPENAI_API_KEY: Boolean(cofre.OPENAI_API_KEY || process.env['OPENAI_API_KEY']),
    MOONSHOT_API_KEY: Boolean(cofre.MOONSHOT_API_KEY || process.env['MOONSHOT_API_KEY']),
  };
}
