/**
 * Chaves de API guardadas com criptografia do SO (safeStorage: Keychain no mac,
 * DPAPI no Windows). Carregadas no boot e injetadas em process.env — o core
 * continua lendo process.env sem saber da existência deste módulo.
 * Migra automaticamente chaves que já estavam num .env legado.
 * Honestidade do status (P0-06): blob indecifrável = "invalida", nunca "ok";
 * salvar sem cofre disponível FALHA em vez de descartar a chave.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { writeFileAtomicSync } from '../core/atomic-write.js';

export type NomeChave = 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'MOONSHOT_API_KEY';
const CHAVES: NomeChave[] = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MOONSHOT_API_KEY'];

export type StatusChave = 'ok' | 'invalida' | 'ausente';
export interface StatusCofre {
  cofreDisponivel: boolean;
  chaves: Record<NomeChave, StatusChave>;
}

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

/** Grava uma chave criptografada (valor vazio remove). Lança se o cofre não estiver disponível. */
export function salvarChave(root: string, nome: NomeChave, valor: string): void {
  const cofre = lerCofre(root);
  if (valor.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('o cofre do sistema não está disponível — não dá para salvar a chave com segurança agora');
    }
    cofre[nome] = safeStorage.encryptString(valor.trim()).toString('base64');
    process.env[nome] = valor.trim();
  } else {
    delete cofre[nome];
    delete process.env[nome];
  }
  writeFileAtomicSync(arq(root), JSON.stringify(cofre, null, 2));
}

/** Carrega o cofre e injeta em process.env. Importa (sem apagar) de um .env se preciso. */
export function carregarChaves(root: string): void {
  const cofre = lerCofre(root);
  for (const nome of CHAVES) {
    if (cofre[nome] && safeStorage.isEncryptionAvailable()) {
      try {
        process.env[nome] = safeStorage.decryptString(Buffer.from(cofre[nome]!, 'base64'));
      } catch {
        console.warn(`chave ${nome} no cofre está indecifrável — reconfigure em Configurações`);
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

/** Estado REAL das chaves (valida a descriptografia; nunca revela o valor). */
export function statusChaves(root: string): StatusCofre {
  const cofre = lerCofre(root);
  const disponivel = safeStorage.isEncryptionAvailable();
  const chaves = {} as Record<NomeChave, StatusChave>;
  for (const nome of CHAVES) {
    if (cofre[nome]) {
      if (!disponivel) {
        chaves[nome] = 'invalida';
        continue;
      }
      try {
        safeStorage.decryptString(Buffer.from(cofre[nome]!, 'base64'));
        chaves[nome] = 'ok';
      } catch {
        chaves[nome] = 'invalida';
      }
    } else {
      chaves[nome] = process.env[nome] ? 'ok' : 'ausente';
    }
  }
  return { cofreDisponivel: disponivel, chaves };
}

const ENDPOINTS: Record<NomeChave, { url: string; headers: (k: string) => Record<string, string> }> = {
  ANTHROPIC_API_KEY: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
  },
  OPENAI_API_KEY: {
    url: 'https://api.openai.com/v1/models',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  MOONSHOT_API_KEY: {
    url: 'https://api.moonshot.ai/v1/models',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
};

/** Testa a chave EM USO (process.env) contra a API do provedor — nenhum dado clínico é enviado. */
export async function testarChave(nome: NomeChave): Promise<{ ok: boolean; erro?: string }> {
  const valor = process.env[nome];
  if (!valor) return { ok: false, erro: 'chave não configurada' };
  const { url, headers } = ENDPOINTS[nome];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(url, { headers: headers(valor), signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.ok) return { ok: true };
    if (resp.status === 401 || resp.status === 403) return { ok: false, erro: 'chave inválida ou revogada' };
    return { ok: false, erro: `serviço respondeu ${resp.status}` };
  } catch {
    return { ok: false, erro: 'sem conexão com o serviço' };
  }
}
