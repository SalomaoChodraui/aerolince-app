/**
 * Padrões de identificadores pessoais em laudos radiológicos PT-BR.
 * A ordem importa: padrões com rótulo (mais específicos) rodam antes dos genéricos.
 */

export interface PatternDef {
  tipo: string;
  regex: RegExp;
  /** Substituição; grupos de captura podem preservar o rótulo (ex.: "CPF: [ID]"). */
  replacement: string;
}

export const PATTERNS: PatternDef[] = [
  // Linhas rotuladas com nome de pessoa — mascara só o valor, preserva o rótulo
  {
    tipo: 'nome',
    regex:
      /(^\s*(?:paciente|nome(?:\s+do\s+paciente)?|solicitante|requisitante|m[eé]dico(?:\s+(?:solicitante|assistente|requisitante))?)\s*[:.]\s*)(.+)$/gim,
    replacement: '$1[NOME]',
  },
  // "Dr. Fulano de Tal" / "Dra. Fulana" em qualquer posição
  {
    tipo: 'nome',
    regex:
      /\b(Dr[a]?\.?\s+)([A-ZÀ-Ú][a-zà-úA-ZÀ-Ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-úA-ZÀ-Ú]+)+)/g,
    replacement: '$1[NOME]',
  },
  // CPF formatado
  {
    tipo: 'cpf',
    regex: /\b\d{3}\.\d{3}\.\d{3}-?\d{2}\b/g,
    replacement: '[CPF]',
  },
  // Identificadores rotulados: CPF, RG, CNS, prontuário, registro, protocolo, accession, OS…
  {
    tipo: 'id',
    regex:
      /\b((?:cpf|rg|cns|cart[aã]o\s+sus|prontu[aá]rio|registro|protocolo|accession|atendimento|ficha|pedido|exame|os)\s*(?:n[ºo°.]?\s*)?[:.]\s*)[\d.\-\/\s]{3,}\b/gi,
    replacement: '$1[ID]',
  },
  // CRM (com ou sem UF)
  {
    tipo: 'crm',
    regex: /\bCRM[-\s\/]?[A-Z]{0,2}\s*[:.]?\s*\d{3,7}\b/gi,
    replacement: 'CRM [CRM]',
  },
  // Datas numéricas (dd/mm/aaaa, dd-mm-aa…)
  {
    tipo: 'data',
    regex: /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g,
    replacement: '[DATA]',
  },
  // Datas por extenso ("15 de julho de 2026")
  {
    tipo: 'data',
    regex:
      /\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+\d{4}\b/gi,
    replacement: '[DATA]',
  },
  // Telefones formatados: (11) 98765-4321, 11 98765-4321, 3456-7890
  {
    tipo: 'telefone',
    regex: /(?:\(\d{2}\)\s?|\b\d{2}\s)?\b9?\d{4}[-]\d{4}\b/g,
    replacement: '[TEL]',
  },
];

/** Palavras que jamais devem ser tratadas como nome próprio (títulos de exame etc.). */
export const NAME_STOPWORDS = new Set([
  'TOMOGRAFIA',
  'COMPUTADORIZADA',
  'RESSONANCIA',
  'RESSONÂNCIA',
  'MAGNETICA',
  'MAGNÉTICA',
  'ABDOME',
  'TOTAL',
  'TORAX',
  'TÓRAX',
  'CRANIO',
  'CRÂNIO',
  'PESCOCO',
  'PESCOÇO',
  'COLUNA',
  'LOMBAR',
  'CERVICAL',
  'DORSAL',
  'BACIA',
  'JOELHO',
  'SEIOS',
  'FACE',
]);
