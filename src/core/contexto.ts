/**
 * Contexto injetado na geração: REGRAS DO MÉDICO + FRASÁRIO + perfil de estilo.
 * Compartilhado entre a CLI (Fase 0) e o app Electron (Fase 1).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { Config } from './config/schema.js';

/** REGRAS DO MÉDICO (gerais + da máscara) e FRASÁRIO aplicável, se existirem. */
export function loadRegras(config: Config, maskId: string): string | undefined {
  const parts: string[] = [];
  const regrasDir = join(config.masksDir, 'regras');
  for (const f of ['gerais.md', `${maskId}.md`]) {
    const p = join(regrasDir, f);
    if (existsSync(p)) parts.push(readFileSync(p, 'utf8').trim());
  }
  // Frasário dos médicos: arquivos com frontmatter `aplica_a: [mask-ids]` (vazio = todas)
  const frasarioDir = join(config.masksDir, 'frasario');
  if (existsSync(frasarioDir)) {
    for (const f of readdirSync(frasarioDir).filter((x) => x.endsWith('.md')).sort()) {
      const { data, content } = matter(readFileSync(join(frasarioDir, f), 'utf8'));
      const aplica = Array.isArray(data.aplica_a) ? (data.aplica_a as string[]) : [];
      if (aplica.length === 0 || aplica.includes(maskId)) {
        parts.push(`FRASÁRIO PRONTO DOS MÉDICOS (${f}) — use estas frases quando o achado ditado corresponder:\n${content.trim()}`);
      }
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export interface Profile {
  name: string;
  body: string;
}

export function loadProfile(config: Config, id: string): Profile {
  const path = join(config.profilesDir, `${id}.md`);
  if (!existsSync(path)) throw new Error(`perfil não encontrado: ${id}`);
  const { data, content } = matter(readFileSync(path, 'utf8'));
  return { name: (data.nome as string) ?? id, body: content.trim() };
}
