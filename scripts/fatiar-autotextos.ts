/**
 * Fatia o autotextos.md (transversal, entrava em TODO laudo) em arquivos por
 * tema com `aplica_a` específico — cada laudo só carrega o frasário do seu exame.
 * O arquivo original vai para _originais/autotextos-compactado.md.
 *
 * Uso: npx tsx scripts/fatiar-autotextos.ts
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { loadConfig } from '../src/core/config/schema.js';

const ABDOME = ['tc-abdome-total', 'tc-abdome-total-com-contraste'];
const OSSOS = [
  'tc-coluna-lombar',
  'tc-coluna-cervical',
  'tc-coluna-toracica',
  'tc-bacia',
  'tc-joelho',
  'tc-tornozelo',
  'tc-punho',
  'tc-pe',
  'tc-cotovelo',
  'tc-ombro',
  'tc-sacro-iliacas',
];

const CLASSIFICACAO: Array<[RegExp, string[] | null]> = [
  [/cranio|cerebr|encef|neuro/i, ['tc-cranio']],
  [/torax|pulm|pleur|mediastin/i, ['tc-torax']],
  [/osso|coluna|vertebr|esquel|articula|fratur/i, OSSOS],
  [/vascular|aorta|arteri/i, [...ABDOME, 'tc-torax']],
  [/rim|rins|urin|renal|bexiga/i, ABDOME],
  [/face|pescoc|seios|sinus|mastoide|orbit/i, ['tc-seios-da-face', 'tc-mastoides', 'tc-pescoco']],
  [/gastro|intestin|colon|digest|\bgi\b|alcas/i, ABDOME],
  [/figado|hepat|biliar|vesicula/i, ABDOME],
  [/pancrea|baco|adrenal|espleni/i, ABDOME],
  [/pelve|gineco|utero|ovari|prostat/i, [...ABDOME, 'tc-bacia']],
  [/divers|fragment/i, null], // fragmentos soltos — não injetar
  [/tecnica|generic|geral/i, []], // transversal
];

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

const config = loadConfig(process.cwd());
const dir = join(config.masksDir, 'frasario');
const src = join(dir, 'autotextos.md');
if (!existsSync(src)) {
  console.error('frasario/autotextos.md não encontrado — nada a fatiar');
  process.exit(0);
}
const { content } = matter(readFileSync(src, 'utf8'));

// Divide por seções "## "
const partes = content.split(/^## /m).filter((p) => p.trim());
let escritos = 0;
let pulados = 0;
for (const parte of partes) {
  const [tituloLinha, ...resto] = parte.split('\n');
  const titulo = tituloLinha!.trim();
  const corpo = resto.join('\n').trim();
  if (!corpo) continue;
  const norm = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const regra = CLASSIFICACAO.find(([re]) => re.test(norm));
  const aplica = regra ? regra[1] : [];
  if (aplica === null) {
    pulados++;
    continue;
  }
  const out = join(dir, `autotextos-${slug(titulo)}.md`);
  writeFileSync(
    out,
    `---\naplica_a: [${aplica.join(', ')}]\nfonte: "Texter Replacement Guide.html"\ntema: "${titulo}"\n---\n\n## ${titulo}\n\n${corpo}\n`,
    'utf8',
  );
  console.log(`${titulo} → aplica_a: [${aplica.join(', ') || 'todas'}]`);
  escritos++;
}

mkdirSync(join(dir, '_originais'), { recursive: true });
renameSync(src, join(dir, '_originais', 'autotextos-compactado.md'));
console.log(`\n${escritos} fatias escritas, ${pulados} seções não injetáveis; original movido para _originais/`);
