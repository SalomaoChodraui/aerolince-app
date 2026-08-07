/**
 * Validação determinística do laudo final — última linha de defesa antes do
 * clipboard: resíduo técnico (marcador, cabeçalho de patch, truncamento) e
 * nota de processo (meta-texto do modelo, ex.: "(bloco removido…)")
 * BLOQUEIAM a entrega; placeholder de anonimização vira aviso ao médico.
 */

/** Placeholders que o anonymizer pode ter injetado no comando ditado. */
export const PLACEHOLDERS_ANONIMIZACAO = ['[NOME]', '[CPF]', '[ID]', '[CRM]', '[DATA]', '[TEL]'];

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Vocabulário de PROCESSO/sistema dentro de parêntese — nunca pertence a um
 * laudo. Deliberadamente restrito: parênteses clínicos legítimos ("(não
 * caracterizado)", "(Bosniak II)", "(vide comparativo)") não podem disparar.
 */
const PROCESSO_EM_PARENTESE_RE = /\b(bloco|patch|mascara|template|placeholder)\b/;

/** Expressões de processo que bloqueiam onde quer que apareçam no laudo. */
const FRASES_DE_PROCESSO = ['nao e achado', 'removido pelo sistema', 'nao se aplica a este exame'];

export interface ValidacaoLaudo {
  /** Impedem a entrega. */
  erros: string[];
  /** O médico precisa ver, mas não bloqueiam. */
  avisos: string[];
}

export function validarLaudo(report: string): ValidacaoLaudo {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (report.trim().length < 100) erros.push('laudo suspeitamente curto — geração provavelmente truncada');
  if (/<!--|-->/.test(report)) erros.push('marcador técnico interno vazou para o texto');
  if (/^@@/m.test(report)) erros.push('cabeçalho de patch vazou para o texto');
  const normalizado = semAcento(report).toLowerCase();
  for (const frase of FRASES_DE_PROCESSO) {
    if (normalizado.includes(frase)) {
      erros.push(
        `nota de processo no laudo (contém "${frase}") — o modelo escreveu um comentário de sistema em vez de texto de laudo`,
      );
    }
  }
  for (const m of report.matchAll(/\(([^)]*)\)/g)) {
    if (PROCESSO_EM_PARENTESE_RE.test(semAcento(m[1]!).toLowerCase())) {
      erros.push(
        `nota de processo entre parênteses no laudo: "(${m[1]})" — o laudo deve conter apenas texto de laudo, nunca comentários do sistema sobre blocos, patches ou máscara`,
      );
    }
  }
  for (const ph of PLACEHOLDERS_ANONIMIZACAO) {
    if (report.includes(ph)) {
      avisos.push(`o laudo contém ${ph} — um dado pessoal foi removido do comando; complete à mão se fizer falta`);
    }
  }
  return { erros, avisos };
}
