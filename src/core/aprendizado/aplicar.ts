/**
 * Promoção/descarte de rascunhos gerados por `destilarMascara`/`aprenderRegras`.
 * Rascunhos vivem em `<masksDir>/_rascunhos/` até o médico revisar; só entram
 * na biblioteca (onde a geração de fato os lê) via `aplicarRascunho`, que
 * também protege a curadoria manual existente com backup `.bak`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import matter from 'gray-matter';
import { MaskFrontmatterSchema } from '../masks/schema.js';

export interface Rascunho {
  arquivo: string;
  tipo: 'mascara' | 'regras';
  alvo: string;
}

const REGRAS_RE = /^regras-(.+)\.md$/;

function rascunhosDir(masksDir: string): string {
  return join(masksDir, '_rascunhos');
}

/**
 * Barreira contra path traversal: `arquivo` é sempre um NOME DE ARQUIVO dentro de
 * `_rascunhos/`, nunca um caminho. Rejeita:
 * - qualquer `/` ou `\` explícito — checado por conteúdo, não via `basename()`, para não
 *   depender da semântica de separador do SO (POSIX não trata `\` como separador; um
 *   `arquivo` com `\` passaria por `arquivo === basename(arquivo)` rodando em Mac/Linux
 *   mesmo sendo um vetor de traversal em Windows) nem de um refactor futuro de `node:path`;
 * - os componentes especiais `.`/`..` (escapam via `join()` mesmo sem nenhuma barra —
 *   `join(dir, '..')` sobe um nível sem nada disso aparecer no input);
 * - divergência de `basename()` como rede de segurança adicional para qualquer outro caso.
 *
 * Exportada para reuso defensivo (ex.: `lerRascunho` abaixo, ou validações equivalentes
 * na T5/Electron).
 */
export function validarNomeRascunho(arquivo: string): void {
  if (
    !arquivo ||
    arquivo === '.' ||
    arquivo === '..' ||
    arquivo.includes('/') ||
    arquivo.includes('\\') ||
    arquivo !== basename(arquivo)
  ) {
    throw new Error(`nome de rascunho inválido: ${arquivo}`);
  }
}

/**
 * Lê o conteúdo de um rascunho (`<masksDir>/_rascunhos/<arquivo>`) sem promovê-lo nem
 * descartá-lo. Valida `arquivo` com `validarNomeRascunho` antes de tocar o disco — usado
 * pela T5 (main/Electron) para exibir o rascunho na UI sem reimplementar a leitura (e sem
 * reabrir a porta de path traversal fechada aqui).
 */
export function lerRascunho(masksDir: string, arquivo: string): string {
  validarNomeRascunho(arquivo);
  const origem = join(rascunhosDir(masksDir), arquivo);
  if (!existsSync(origem)) throw new Error(`rascunho não encontrado: ${arquivo}`);
  return readFileSync(origem, 'utf8');
}

function classificar(arquivo: string): { tipo: 'mascara' | 'regras'; alvo: string } {
  const m = REGRAS_RE.exec(arquivo);
  return m ? { tipo: 'regras', alvo: m[1]! } : { tipo: 'mascara', alvo: arquivo.replace(/\.md$/, '') };
}

/** Lista os rascunhos pendentes (`<masksDir>/_rascunhos/*.md`), ordenados por nome de arquivo. */
export function listarRascunhos(masksDir: string): Rascunho[] {
  const dir = rascunhosDir(masksDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((arquivo) => ({ arquivo, ...classificar(arquivo) }));
}

function destinoDe(masksDir: string, tipo: 'mascara' | 'regras', alvo: string): string {
  return tipo === 'regras' ? join(masksDir, 'regras', `${alvo}.md`) : join(masksDir, `${alvo}.md`);
}

/**
 * Promove um rascunho para a biblioteca. Máscara → `<masksDir>/<id>.md`;
 * regras → `<masksDir>/regras/<id>.md`. Se o destino já existir, é copiado
 * antes para `<destino>.bak`. Rascunho de máscara com frontmatter inválido
 * (zod) lança erro claro e NÃO toca o destino nem o rascunho.
 */
export function aplicarRascunho(masksDir: string, arquivo: string): { destino: string; backup?: string } {
  validarNomeRascunho(arquivo);
  const origem = join(rascunhosDir(masksDir), arquivo);
  if (!existsSync(origem)) throw new Error(`rascunho não encontrado: ${arquivo}`);

  const { tipo, alvo } = classificar(arquivo);
  const conteudo = readFileSync(origem, 'utf8');

  if (tipo === 'mascara') {
    const { data } = matter(conteudo);
    const parsed = MaskFrontmatterSchema.safeParse(data);
    if (!parsed.success) {
      const motivos = parsed.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
      throw new Error(`rascunho de máscara inválido (${arquivo}) — não aplicado: ${motivos}`);
    }
  }

  const destino = destinoDe(masksDir, tipo, alvo);
  mkdirSync(dirname(destino), { recursive: true });

  let backup: string | undefined;
  if (existsSync(destino)) {
    backup = `${destino}.bak`;
    copyFileSync(destino, backup);
  }

  renameSync(origem, destino); // move atômico (mesma árvore de diretórios que _rascunhos)

  return { destino, backup };
}

/** Descarta um rascunho sem aplicá-lo. */
export function descartarRascunho(masksDir: string, arquivo: string): void {
  validarNomeRascunho(arquivo);
  const origem = join(rascunhosDir(masksDir), arquivo);
  if (!existsSync(origem)) throw new Error(`rascunho não encontrado: ${arquivo}`);
  unlinkSync(origem);
}
