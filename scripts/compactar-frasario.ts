/**
 * Compacta arquivos de frasário grandes demais para injeção em prompt:
 * destila em frases únicas agrupadas por tema, preservando o fraseado literal.
 * Originais preservados em frasario/_originais/.
 *
 * Uso: npx tsx scripts/compactar-frasario.ts [limite-kb]   (padrão: 20)
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';
import { loadConfig } from '../src/core/config/schema.js';
import { LLMClient, estimateCostUSD } from '../src/core/llm/anthropic.js';

const LIMITE_KB = Number(process.argv[2] ?? 20);
const config = loadConfig(process.cwd());
const dir = join(config.masksDir, 'frasario');
const originais = join(dir, '_originais');
mkdirSync(originais, { recursive: true });

const SYSTEM = `Você compacta frasários de laudo radiológico. Receberá um documento grande com frases/modelos que médicos usam para descrever achados. Produza uma versão COMPACTA em markdown:

- Agrupe por tema/órgão/patologia com cabeçalhos "## ".
- Uma frase por linha, SEM numeração e sem comentários.
- FIDELIDADE LITERAL: copie as frases exatamente como estão (pontuação, medidas, placeholders como ___ ou [x]). Não reescreva nem "melhore".
- Remova: duplicatas e quase-duplicatas (mantenha a variante mais completa), narrativas de casos, cabeçalhos administrativos, laudos normais inteiros (só interessam frases PATOLÓGICAS e frases condicionais úteis), lixo de formatação.
- Se houver modelos de laudo completos no meio, extraia deles apenas as frases patológicas.
- Alvo: as ~150-250 frases mais úteis e distintas. Priorize cobertura de patologias diferentes, não variações da mesma.
- Responda SÓ com o markdown compactado (sem frontmatter — ele será preservado à parte).`;

const llm = new LLMClient();
let total = 0;

for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
  const path = join(dir, f);
  const kb = statSync(path).size / 1024;
  if (kb <= LIMITE_KB) {
    console.log(`ok      ${f} (${kb.toFixed(0)} KB)`);
    continue;
  }
  const raw = readFileSync(path, 'utf8');
  const { data, content } = matter(raw);
  process.stdout.write(`compactando ${f} (${kb.toFixed(0)} KB)… `);
  const r = await llm.complete({
    model: config.llm.generationModel,
    system: [{ text: SYSTEM, cache: true }],
    user: content,
    maxTokens: 8000,
  });
  const custo = estimateCostUSD(config.llm.generationModel, r.usage);
  total += custo;
  renameSync(path, join(originais, f));
  const fm = Object.entries(data)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : JSON.stringify(v)}`)
    .join('\n');
  writeFileSync(
    path,
    `---\n${fm}\ncompactado_de_kb: ${Math.round(kb)}\n---\n\n${r.text.trim()}\n`,
    'utf8',
  );
  const novoKb = statSync(path).size / 1024;
  console.log(`→ ${novoKb.toFixed(0)} KB (US$ ${custo.toFixed(3)}) — original em _originais/`);
}
console.log(`\nCusto total da compactação: US$ ${total.toFixed(2)}`);
