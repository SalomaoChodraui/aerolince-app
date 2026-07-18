import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { Mask, MaskFrontmatterSchema } from './schema.js';

/** Carrega todas as máscaras .md de um diretório, validando frontmatter e ids únicos. */
export function loadLibrary(dir: string): Mask[] {
  const masks: Mask[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const filePath = join(dir, file);
    const { data, content } = matter(readFileSync(filePath, 'utf8'));
    const fm = MaskFrontmatterSchema.parse(data);
    if (seen.has(fm.id)) throw new Error(`id de máscara duplicado: ${fm.id} (${file})`);
    seen.add(fm.id);
    masks.push({ ...fm, body: content.trim(), filePath });
  }
  if (masks.length === 0) throw new Error(`nenhuma máscara .md encontrada em ${dir}`);
  return masks;
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
