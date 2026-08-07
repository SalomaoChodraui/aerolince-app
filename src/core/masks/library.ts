import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { Mask, MaskFrontmatterSchema } from './schema.js';

/** Carrega uma camada; devolve mapa id → Mask. Duplicata na MESMA camada = erro. */
function loadCamada(dir: string): Map<string, Mask> {
  const camada = new Map<string, Mask>();
  if (!existsSync(dir)) return camada;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const filePath = join(dir, file);
    const { data, content } = matter(readFileSync(filePath, 'utf8'));
    // Arquivos .md sem frontmatter de máscara (anotações, documentos) são ignorados
    if (typeof data.id !== 'string') continue;
    const fm = MaskFrontmatterSchema.parse(data);
    if (camada.has(fm.id)) throw new Error(`id de máscara duplicado: ${fm.id} (${file})`);
    camada.set(fm.id, { ...fm, body: content.trim(), filePath });
  }
  return camada;
}

/**
 * Carrega máscaras de uma ou mais camadas (precedência CRESCENTE: a última
 * vence por id — biblioteca do médico cobre a base). Camada ausente/vazia é
 * ignorada; zero máscaras no total é erro.
 */
export function loadLibrary(dirs: string | string[]): Mask[] {
  const lista = Array.isArray(dirs) ? dirs : [dirs];
  const porId = new Map<string, Mask>();
  for (const dir of lista) for (const [id, m] of loadCamada(dir)) porId.set(id, m);
  if (porId.size === 0) throw new Error(`nenhuma máscara .md encontrada em ${lista.join(', ')}`);
  return [...porId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Catálogo compacto para o prompt de seleção: uma linha por máscara. */
export function buildCatalog(masks: Mask[]): string {
  return masks
    .map(
      (m) =>
        `${m.id} | ${m.nome} | sinônimos: ${m.sinonimos.join(', ') || '—'} | região: ${m.regiao.join(', ') || '—'}`,
    )
    .join('\n');
}

export function getMask(masks: Mask[], id: string): Mask | undefined {
  return masks.find((m) => m.id === id);
}
