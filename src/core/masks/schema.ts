import { z } from 'zod';

export const MaskFrontmatterSchema = z.object({
  id: z.string().regex(/^[a-z0-9\-]+$/, 'id deve ser kebab-case'),
  modalidade: z.string(),
  regiao: z.array(z.string()).default([]),
  nome: z.string(),
  sinonimos: z.array(z.string()).default([]),
  contraste: z.enum(['sem', 'com', 'opcional']).default('sem'),
  versao: z.number().default(1),
  origem: z.enum(['importado-pdf', 'consenso', 'manual', 'base']).default('manual'),
  /** Prefixos dos arquivos do acervo que alimentam esta máscara (aprender/destilar). */
  prefixos: z.array(z.string()).default([]),
  /** Filtros de conteúdo do corpus do `aprender` (ex.: separar com/sem contraste). */
  corpus_contendo: z.string().optional(),
  corpus_sem: z.string().optional(),
});

export type MaskFrontmatter = z.infer<typeof MaskFrontmatterSchema>;

export interface Mask extends MaskFrontmatter {
  /** Corpo markdown da máscara (com marcadores <!-- orgao: --> e <!-- impressao -->). */
  body: string;
  filePath: string;
}
