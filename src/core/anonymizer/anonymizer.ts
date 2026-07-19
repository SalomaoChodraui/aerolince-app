import { PATTERNS, PatternDef } from './patterns.js';

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

export interface ComandoSanitizado {
  texto: string;
  /** Avisos legíveis para o médico (dedup por tipo). */
  avisos: string[];
}

const TIPO_LEGIVEL: Record<string, string> = {
  nome: 'um nome',
  cpf: 'um CPF',
  id: 'um número de registro',
  crm: 'um CRM',
  telefone: 'um telefone',
};

/**
 * Padrões próprios do ditado: param no fim do nome próprio / número, preservando
 * o conteúdo clínico ao redor (diferente dos rótulos de linha inteira dos PDFs).
 */
const COMANDO_EXTRA: PatternDef[] = [
  {
    tipo: 'nome',
    // "paciente João da Silva" / "paciente: João da Silva" / "solicitante Maria Souza"
    regex:
      /\b([Pp]aciente|[Ss]olicitante)(\s*[:,]?\s+)((?:[A-ZÀ-Ú][a-zà-úü]+)(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-úü]+)+)/g,
    replacement: '$1$2[NOME]',
  },
  {
    tipo: 'id',
    // "prontuário 123456" ditado sem a pontuação exigida pelo pattern de documento
    regex: /\b(prontu[aá]rio|registro|protocolo|atendimento)\s+(\d[\d.\-\/]{2,})/gi,
    replacement: '$1 [ID]',
  },
];

/**
 * Sanitização do COMANDO DITADO antes de qualquer LLM. Datas NÃO são removidas —
 * em ditado são conteúdo clínico legítimo ("comparar com exame de 15/03/2026");
 * geram apenas aviso. Os demais identificadores são mascarados.
 */
export function sanitizeComando(transcript: string): ComandoSanitizado {
  const tiposVistos = new Set<string>();
  let texto = transcript;
  let temData = false;
  const aplicaveis = [...COMANDO_EXTRA, ...PATTERNS.filter((p) => p.escopo !== 'documento')];
  for (const { tipo, regex, replacement } of aplicaveis) {
    if (tipo === 'data') {
      if (!temData) temData = new RegExp(regex.source, regex.flags.replace('g', '')).test(texto);
      continue;
    }
    texto = texto.replace(regex, (...args) => {
      tiposVistos.add(tipo);
      return replacement.replace(/\$(\d)/g, (_, n) => {
        const group = args[Number(n)];
        return typeof group === 'string' ? group : '';
      });
    });
  }
  const avisos = [...tiposVistos].map((t) => `removi ${TIPO_LEGIVEL[t] ?? t} do comando por privacidade`);
  if (temData) avisos.push('o comando cita uma data — confira se ela não identifica o paciente');
  return { texto, avisos };
}
