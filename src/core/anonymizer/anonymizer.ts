import { PATTERNS } from './patterns.js';

export interface AnonFinding {
  tipo: string;
  original: string;
}

export interface SanitizeResult {
  clean: string;
  findings: AnonFinding[];
}

export interface SanitizeOptions {
  /**
   * Nomes conhecidos a mascarar em qualquer posição do texto (ex.: extraídos do
   * nome do arquivo "..._ISRAEL-ANDRETTA.pdf"). Aceita "ISRAEL ANDRETTA" ou
   * "ISRAEL-ANDRETTA"; o casamento ignora caixa e aceita espaço/hífen como separador.
   */
  extraNames?: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Classes de equivalência para casar nomes com/sem acento (arquivo vem sem, corpo pode ter). */
const ACCENT_CLASSES: Record<string, string> = {
  a: '[aáâãà]',
  e: '[eéê]',
  i: '[ií]',
  o: '[oóôõ]',
  u: '[uúü]',
  c: '[cç]',
};

function tokenToPattern(token: string): string {
  return [...token.toLowerCase()]
    .map((ch) => ACCENT_CLASSES[ch] ?? escapeRegex(ch))
    .join('');
}

/**
 * Constrói regex flexível para um nome completo: separadores espaço/hífen,
 * qualquer caixa, acentos opcionais (JOSE casa "José").
 */
function nameToRegex(name: string): RegExp | null {
  const tokens = name
    .split(/[\s\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  const pattern = tokens.map(tokenToPattern).join('[\\s\\-]+');
  return new RegExp(`\\b${pattern}\\b`, 'gi');
}

/**
 * Sanitização local de texto de laudo: remove identificadores pessoais ANTES de
 * qualquer envio para APIs externas. Função pura — não faz IO nem rede.
 */
export function sanitize(text: string, options: SanitizeOptions = {}): SanitizeResult {
  const findings: AnonFinding[] = [];
  let clean = text;

  // 1. Nomes conhecidos (do nome do arquivo) — antes de tudo, em qualquer posição
  for (const name of options.extraNames ?? []) {
    const re = nameToRegex(name);
    if (!re) continue;
    clean = clean.replace(re, (match) => {
      findings.push({ tipo: 'nome', original: match });
      return '[NOME]';
    });
  }

  // 2. Padrões gerais, em ordem
  for (const { tipo, regex, replacement } of PATTERNS) {
    clean = clean.replace(regex, (...args) => {
      const match = args[0] as string;
      findings.push({ tipo, original: match });
      // Reaplica os grupos de captura do replacement ($1, $2…)
      return replacement.replace(/\$(\d)/g, (_, n) => {
        const group = args[Number(n)];
        return typeof group === 'string' ? group : '';
      });
    });
  }

  return { clean, findings };
}

/** Extrai o nome do paciente do padrão de arquivo "AAAA-MM-DD_NNNNN_EXAME_NOME-DO-PACIENTE.pdf". */
export function patientNameFromFilename(filename: string): string | null {
  const base = filename.replace(/\.pdf$/i, '');
  const parts = base.split('_');
  if (parts.length < 4) return null;
  const name = parts.slice(3).join(' ').replace(/-/g, ' ').trim();
  return name.length >= 2 ? name : null;
}

/** Extrai o tipo de exame do mesmo padrão de arquivo (ex.: "ABDOME-TOTAL"). */
export function examTypeFromFilename(filename: string): string | null {
  const base = filename.replace(/\.pdf$/i, '');
  const parts = base.split('_');
  return parts.length >= 3 && parts[2] ? parts[2] : null;
}
