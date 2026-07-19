/**
 * Diff bloco-a-bloco entre máscara e laudo gerado — a defesa antialucinação:
 * mostra ao médico exatamente quais blocos de órgão foram alterados.
 */

export interface OrganBlock {
  id: string;
  text: string;
}

const MARKER_RE = /^<!--\s*(?:orgao:\s*([a-z0-9\-\/]+)|(impressao))\s*-->$/i;

/** Extrai os blocos marcados da máscara: marcador na linha acima, bloco até linha em branco. */
export function parseOrganBlocks(maskBody: string): OrganBlock[] {
  const lines = maskBody.split('\n');
  const blocks: OrganBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.trim().match(MARKER_RE);
    if (!m) continue;
    const id = m[1] ?? 'impressao';
    const textLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === '' || MARKER_RE.test(line.trim())) break;
      textLines.push(line);
    }
    if (textLines.length > 0) blocks.push({ id, text: textLines.join('\n').trim() });
  }
  return blocks;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface DiffResult {
  /** Blocos cujo texto normal da máscara NÃO aparece mais no laudo (= substituídos). */
  changed: string[];
  /** Blocos preservados literalmente. */
  kept: string[];
}

export function diffAgainstMask(maskBody: string, report: string): DiffResult {
  const normReport = normalize(report);
  const changed: string[] = [];
  const kept: string[] = [];
  for (const block of parseOrganBlocks(maskBody)) {
    if (normReport.includes(normalize(block.text))) kept.push(block.id);
    else changed.push(block.id);
  }
  return { changed, kept };
}

/** Linha que é só um comentário HTML — qualquer marcador, mesmo malformado/acentuado. */
const COMMENT_LINE_RE = /^<!--.*-->$/;

/** Remove os marcadores HTML do laudo final (o que vai para o clipboard). */
export function stripMarkers(report: string): string {
  return report
    .split('\n')
    .filter((line) => !COMMENT_LINE_RE.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
