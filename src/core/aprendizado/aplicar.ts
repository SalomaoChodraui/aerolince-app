/**
 * Promoção/descarte de rascunhos gerados por `destilarMascara`/`aprenderRegras`.
 * Rascunhos vivem em `<masksDir>/_rascunhos/` até o médico revisar; só entram
 * na biblioteca (onde a geração de fato os lê) via `aplicarRascunho`, que
 * também protege a curadoria manual existente com backup `.bak`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  const origem = join(rascunhosDir(masksDir), arquivo);
  if (!existsSync(origem)) throw new Error(`rascunho não encontrado: ${arquivo}`);
  unlinkSync(origem);
}
