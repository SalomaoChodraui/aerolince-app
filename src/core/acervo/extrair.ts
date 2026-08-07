/**
 * Extração de texto local (sem binário externo) de PDF, DOCX e TXT — usada pelo
 * módulo de acervo (Bloco 3). PDF via pdfjs-dist (import dinâmico do subpath
 * legacy, evita custo no boot do app); DOCX via mammoth; TXT lido direto.
 *
 * Texto extraído com menos de 40 caracteres não-espaço nunca é descartado em
 * silêncio: volta como `{ ok: false, motivo: 'sem-texto' }` para o chamador
 * contar e reportar (ex.: PDF só-imagem, precisaria de OCR).
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import mammoth from 'mammoth';

export type ResultadoExtracao =
  | { ok: true; texto: string }
  | { ok: false; motivo: 'sem-texto' | 'formato' | 'erro'; detalhe?: string };

const MIN_CHARS_UTEIS = 40;

function charsUteis(texto: string): number {
  return texto.replace(/\s/g, '').length;
}

async function extrairDePdf(caminho: string): Promise<string> {
  const buffer = await readFile(caminho);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const paginas: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Cada item já vem com seus próprios espaços internos (runs separados por
    // glifo/posição); só falta o `\n` que o pdfjs sinaliza via `hasEOL`.
    const textoPagina = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
      .join('');
    paginas.push(textoPagina);
  }
  return paginas.join('\n');
}

async function extrairDeDocx(caminho: string): Promise<string> {
  const resultado = await mammoth.extractRawText({ path: caminho });
  return resultado.value;
}

async function extrairDeTxt(caminho: string): Promise<string> {
  return readFile(caminho, 'utf8');
}

/** Extrai texto de um arquivo local (.pdf, .docx ou .txt). */
export async function extrairTexto(caminho: string): Promise<ResultadoExtracao> {
  const ext = extname(caminho).toLowerCase();
  if (ext !== '.pdf' && ext !== '.docx' && ext !== '.txt') {
    return { ok: false, motivo: 'formato', detalhe: ext || '(sem extensão)' };
  }
  try {
    let texto: string;
    if (ext === '.pdf') texto = await extrairDePdf(caminho);
    else if (ext === '.docx') texto = await extrairDeDocx(caminho);
    else texto = await extrairDeTxt(caminho);
    if (charsUteis(texto) < MIN_CHARS_UTEIS) {
      return { ok: false, motivo: 'sem-texto' };
    }
    return { ok: true, texto };
  } catch (erro) {
    return { ok: false, motivo: 'erro', detalhe: erro instanceof Error ? erro.message : String(erro) };
  }
}
