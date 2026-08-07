/**
 * Contexto injetado na geração: REGRAS DO MÉDICO + FRASÁRIO + perfil de estilo.
 * Compartilhado entre a CLI (Fase 0) e o app Electron (Fase 1).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { Config } from './config/schema.js';

/** REGRAS DO MÉDICO (gerais + da máscara) e FRASÁRIO aplicável, em camadas base → médico. */
export function loadRegras(config: Config, maskId: string): string | undefined {
  const camadas = [config.bibliotecaBaseDir, config.masksDir]; // médico por último = vence
  const parts: string[] = [];

  // Regras: resolução POR ARQUIVO — a versão do médico substitui a da base
  for (const f of ['gerais.md', `${maskId}.md`]) {
    let escolhido: string | undefined;
    for (const dir of camadas) {
      const p = join(dir, 'regras', f);
      if (existsSync(p)) escolhido = p;
    }
    if (escolhido) parts.push(readFileSync(escolhido, 'utf8').trim());
  }

  // Frasário: união das camadas; mesmo nome de arquivo → vence o do médico
  const arquivos = new Map<string, { caminho: string; origem: 'base' | 'medico' }>(); // nome → vencedor
  camadas.forEach((dir, i) => {
    const origem = i === camadas.length - 1 ? 'medico' : 'base';
    const frasarioDir = join(dir, 'frasario');
    if (!existsSync(frasarioDir)) return;
    for (const f of readdirSync(frasarioDir).filter((x) => x.endsWith('.md'))) {
      arquivos.set(f, { caminho: join(frasarioDir, f), origem });
    }
  });
  const aplicaveis: { f: string; origem: 'base' | 'medico'; corpo: string }[] = [];
  for (const [f, { caminho, origem }] of [...arquivos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { data, content } = matter(readFileSync(caminho, 'utf8'));
    const aplica = Array.isArray(data.aplica_a) ? (data.aplica_a as string[]) : [];
    if (aplica.length === 0 || aplica.includes(maskId)) aplicaveis.push({ f, origem, corpo: content.trim() });
  }
  // Dedup por CONTEÚDO: cópia da BASE sai quando o médico tem o MESMO corpo sob
  // outro nome (a base renomeou arquivos com nome de médico; sem isto o prompt duplicaria)
  const corposDoMedico = new Set(aplicaveis.filter((a) => a.origem === 'medico').map((a) => a.corpo));
  for (const { f, origem, corpo } of aplicaveis) {
    if (origem === 'base' && corposDoMedico.has(corpo)) continue;
    parts.push(`FRASÁRIO PRONTO DOS MÉDICOS (${f}) — use estas frases quando o achado ditado corresponder:\n${corpo}`);
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
