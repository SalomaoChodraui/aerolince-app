/**
 * Seleção e montagem do corpus de laudos sanitizados usado pelo `destilar`/`aprender`.
 * Lógica de listagem de arquivos movida de `src/cli/index.ts` (T4); só lida com
 * caminhos e texto — nenhuma chamada de LLM aqui.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { corpoDoArquivo } from '../acervo/sanitizar.js';
import { sanitize } from '../anonymizer/anonymizer.js';

export interface FiltroCorpus {
  contendo?: string;
  sem?: string;
}

/**
 * Arquivos sanitizados de `dir` cujo nome começa com algum dos prefixos
 * (mais recentes por último, pela ordenação lexicográfica do nome — o
 * padrão `<exame>_<data>_<indice>.md` cresce com o tempo). Devolve caminhos
 * ABSOLUTOS; `cap` corta os mais antigos.
 */
export function corpusPorPrefixos(dir: string, prefixos: string[], cap: number, filtro?: FiltroCorpus): string[] {
  let files = readdirSync(dir)
    .filter((f) => prefixos.some((p) => f.startsWith(`${p}_`)))
    .sort();
  if (filtro?.contendo || filtro?.sem) {
    files = files.filter((f) => {
      const text = readFileSync(join(dir, f), 'utf8');
      if (filtro.contendo && !text.includes(filtro.contendo)) return false;
      if (filtro.sem && text.includes(filtro.sem)) return false;
      return true;
    });
  }
  return files.slice(-cap).map((f) => join(dir, f));
}

/** Valida a existência de cada arquivo informado explicitamente e aplica o cap pelo FIM da lista. */
export function corpusPorArquivos(arquivos: string[], cap: number): string[] {
  for (const arquivo of arquivos) {
    if (!existsSync(arquivo)) throw new Error(`arquivo do corpus não encontrado: ${arquivo}`);
  }
  return arquivos.slice(-cap);
}

/**
 * Lê cada arquivo via `corpoDoArquivo` (tolera legado sem frontmatter),
 * RE-SANITIZA o corpo com `sanitize().clean` — defesa em profundidade contra
 * um laudo que tenha escapado da sanitização original do acervo — e junta
 * tudo com o separador "─── LAUDO N ───" usado pelos prompts de aprendizado.
 */
export function montarCorpus(arquivos: string[]): { corpus: string; total: number } {
  const corpus = arquivos
    .map((arquivo, i) => {
      const bruto = corpoDoArquivo(arquivo).trim();
      const { clean } = sanitize(bruto);
      return `─── LAUDO ${i + 1} ───\n${clean}`;
    })
    .join('\n\n');
  return { corpus, total: arquivos.length };
}
