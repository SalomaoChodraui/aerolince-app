/**
 * Validação determinística do laudo final — última linha de defesa antes do
 * clipboard: resíduo técnico (marcador, cabeçalho de patch, truncamento)
 * BLOQUEIA a entrega; placeholder de anonimização vira aviso ao médico.
 */

/** Placeholders que o anonymizer pode ter injetado no comando ditado. */
export const PLACEHOLDERS_ANONIMIZACAO = ['[NOME]', '[CPF]', '[ID]', '[CRM]', '[DATA]', '[TEL]'];

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
  for (const ph of PLACEHOLDERS_ANONIMIZACAO) {
    if (report.includes(ph)) {
      avisos.push(`o laudo contém ${ph} — um dado pessoal foi removido do comando; complete à mão se fizer falta`);
    }
  }
  return { erros, avisos };
}
