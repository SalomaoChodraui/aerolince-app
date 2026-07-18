/**
 * CLI da Fase 0 — valida o pipeline comando de voz → laudo pronto.
 *
 *   npm run laudo -- texto "essa tomo é uma diverticulite do colo direito não complicada"
 *   npm run laudo -- gravar            (grava do microfone; ENTER para parar)
 *   npm run laudo -- <arquivo de áudio>
 *   npm run laudo -- masks             (lista a biblioteca)
 *   npm run eval                        (golden set: acurácia de seleção)
 *
 * Flags: --mask <id>  --perfil <id>  --fast  --dry-run
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import matter from 'gray-matter';
import { loadConfig } from '../core/config/schema.js';
import { generate, selectMask } from '../core/engine/engine.js';
import { APRENDER_SYSTEM, DESTILAR_SYSTEM } from '../core/engine/prompts.js';
import { LLMClient, estimateCostUSD } from '../core/llm/anthropic.js';
import { buildCatalog, getMask, loadLibrary } from '../core/masks/library.js';
import { matchLocal } from '../core/masks/matcher.js';
import { copyToClipboard, saveReport, saveSidecar } from '../core/output/output.js';
import { OpenAISTT } from '../core/stt/openai.js';

const APP_ROOT = process.cwd();

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--fast' || a === '--dry-run' || a === '--sonnet') flags.set(a.slice(2), true);
    else if (a === '--mask' || a === '--perfil' || a === '--contendo' || a === '--sem') flags.set(a.slice(2), argv[++i] ?? '');
    else positional.push(a);
  }
  return { flags, positional };
}

function loadMasks(config: ReturnType<typeof loadConfig>) {
  if (existsSync(config.masksDir)) return loadLibrary(config.masksDir);
  console.warn(`AVISO: biblioteca não encontrada em ${config.masksDir} — usando masks-exemplo/`);
  return loadLibrary(resolve(APP_ROOT, 'masks-exemplo'));
}

import { loadProfile, loadRegras } from '../core/contexto.js';

function requireEnv(name: string): void {
  if (!process.env[name]) {
    console.error(
      `ERRO: variável ${name} não definida. Crie um arquivo .env na pasta app/ com:\n${name}=sua-chave-aqui`,
    );
    process.exit(1);
  }
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

async function runPipeline(opts: {
  transcript?: string;
  audioPath?: string;
  maskId?: string;
  perfil?: string;
  fast?: boolean;
  sonnet?: boolean;
  dryRun?: boolean;
}) {
  const config = loadConfig(APP_ROOT);
  const masks = loadMasks(config);
  const profile = loadProfile(config, opts.perfil ?? config.perfilPadrao);
  let transcript = opts.transcript;
  let sttMs = 0;

  if (!transcript && opts.audioPath) {
    requireEnv('OPENAI_API_KEY');
    const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
    process.stdout.write('Transcrevendo… ');
    const r = await stt.transcribe(opts.audioPath);
    transcript = r.text;
    sttMs = r.durationMs;
    console.log(`${fmt(sttMs)}\n> "${transcript}"`);
  }
  if (!transcript) throw new Error('sem comando: use `texto "…"`, `gravar` ou um arquivo de áudio');

  if (opts.dryRun) {
    console.log('=== DRY RUN (nenhuma chamada de API) ===');
    console.log(`Comando: "${transcript}"`);
    console.log(`Perfil: ${profile.name}`);
    console.log(`\nCatálogo de seleção (${masks.length} máscaras):\n${buildCatalog(masks)}`);
    return;
  }

  requireEnv('ANTHROPIC_API_KEY');
  const llm = new LLMClient();

  // Seleção da máscara
  let mask = opts.maskId ? getMask(masks, opts.maskId) : undefined;
  let selMs = 0;
  let selCost = 0;
  let confianca = 'manual';
  if (!mask) {
    const local = matchLocal(transcript, masks);
    if (local) {
      mask = local;
      confianca = 'alta (seleção local, custo zero)';
    }
  }
  if (!mask) {
    const sel = await selectMask(llm, config.llm.selectionModel, transcript, masks);
    selMs = sel.durationMs;
    selCost = estimateCostUSD(config.llm.selectionModel, sel.usage);
    confianca = sel.confianca;
    if (!sel.mask) {
      console.error(`\nNão identifiquei o exame (confiança: ${sel.confianca}).`);
      console.error(`Máscaras disponíveis:\n${masks.map((m) => `  ${m.id} — ${m.nome}`).join('\n')}`);
      console.error(`\nRode de novo com --mask <id>.`);
      process.exit(2);
    }
    mask = sel.mask;
  }
  console.log(`Máscara: ${mask.nome} [${mask.id}] (confiança: ${confianca}, ${fmt(selMs)})`);

  // Geração
  const genModel = opts.sonnet
    ? 'claude-sonnet-5'
    : opts.fast
      ? config.llm.fastModel
      : config.llm.generationModel;
  process.stdout.write(`Gerando laudo (${genModel})… `);
  const regras = loadRegras(config, mask.id);
  const gen = await generate(llm, {
    mask,
    transcript,
    profileName: profile.name,
    profileBody: profile.body,
    model: genModel,
    regras,
  });
  console.log(fmt(gen.durationMs));
  const genCost = estimateCostUSD(genModel, gen.usage);

  // Saída
  console.log('\n' + '─'.repeat(72) + '\n' + gen.report + '\n' + '─'.repeat(72));
  console.log(
    `Blocos alterados: ${gen.diff.changed.join(', ') || 'nenhum'} | preservados: ${gen.diff.kept.length}`,
  );
  const totalMs = sttMs + selMs + gen.durationMs;
  console.log(
    `Tempo total: ${fmt(totalMs)} (stt ${fmt(sttMs)} + seleção ${fmt(selMs)} + geração ${fmt(gen.durationMs)}) | custo LLM ≈ US$ ${(selCost + genCost).toFixed(4)}`,
  );

  await copyToClipboard(gen.report);
  console.log('✓ Copiado para a área de transferência');
  const saved = saveReport(config.outputDir, mask.id, gen.report);
  saveSidecar(saved, {
    transcript,
    maskId: mask.id,
    perfil: profile.name,
    modelo: genModel,
    confianca,
    latenciasMs: { stt: Math.round(sttMs), selecao: Math.round(selMs), geracao: Math.round(gen.durationMs) },
    custoUSD: Number((selCost + genCost).toFixed(4)),
    blocosAlterados: gen.diff.changed,
  });
  console.log(`✓ Salvo em ${saved}`);
  console.log('\nLembrete: este texto é um RASCUNHO — revise antes de assinar.');
}

async function gravar(outPath?: string): Promise<string> {
  const out = outPath ?? join(tmpdir(), `laudo-${Date.now()}.wav`);
  const input =
    process.platform === 'darwin'
      ? ['-f', 'avfoundation', '-i', ':default']
      : ['-f', 'dshow', '-i', 'audio=default'];
  const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...input, '-ac', '1', '-ar', '16000', out]);
  console.log('● Gravando… pressione ENTER para parar.');
  await new Promise<void>((res) => {
    const rl = createInterface({ input: process.stdin });
    rl.once('line', () => {
      rl.close();
      proc.kill('SIGINT');
    });
    proc.once('close', () => res());
  });
  console.log(`Áudio: ${out}`);
  return out;
}

function sanitizedDir(): string {
  const dir = resolve(APP_ROOT, 'tmp-sanitized');
  if (!existsSync(dir)) {
    throw new Error('laudos sanitizados não encontrados — rode antes: npm run sanitize -- "../Modelos de Laudos/Exames_TC_2026"');
  }
  return dir;
}

/** Arquivos sanitizados cujo nome começa com algum dos prefixos (mais recentes por último). */
function corpusFiles(
  sanDir: string,
  prefixos: string[],
  cap: number,
  filtro?: { contendo?: string; sem?: string },
): string[] {
  let files = readdirSync(sanDir)
    .filter((f) => prefixos.some((p) => f.startsWith(`${p}_`)))
    .sort();
  if (filtro?.contendo || filtro?.sem) {
    files = files.filter((f) => {
      const text = readFileSync(join(sanDir, f), 'utf8');
      if (filtro.contendo && !text.includes(filtro.contendo)) return false;
      if (filtro.sem && text.includes(filtro.sem)) return false;
      return true;
    });
  }
  return files.slice(-cap);
}

/**
 * Camada de inteligência: lê os laudos SANITIZADOS do acervo e destila as
 * REGRAS DO MÉDICO (limites de protocolo, frasário patológico, estrutura),
 * que passam a ser injetadas em toda geração daquela máscara.
 */
async function aprender(target: string) {
  requireEnv('ANTHROPIC_API_KEY');
  const config = loadConfig(APP_ROOT);
  const masks = loadMasks(config);
  const sanDir = sanitizedDir();
  const alvo = target === 'todos' ? masks.filter((m) => m.prefixos.length > 0) : masks.filter((m) => m.id === target);
  if (alvo.length === 0) throw new Error(`nenhuma máscara com prefixos para "${target}"`);
  const llm = new LLMClient();
  const regrasDir = join(config.masksDir, 'regras');
  mkdirSync(regrasDir, { recursive: true });
  for (const m of alvo) {
    const id = m.id;
    const files = corpusFiles(sanDir, m.prefixos, 60);
    if (files.length === 0) {
      console.warn(`nenhum laudo sanitizado para ${id} (prefixos: ${m.prefixos.join(', ')})`);
      continue;
    }
    const corpus = files
      .map((f, i) => `─── LAUDO ${i + 1} ───\n${readFileSync(join(sanDir, f), 'utf8').trim()}`)
      .join('\n\n');
    process.stdout.write(`Aprendendo ${id} com ${files.length} laudos… `);
    const t0 = performance.now();
    const r = await llm.complete({
      model: config.llm.generationModel,
      system: [{ text: APRENDER_SYSTEM, cache: true }],
      user: `Tipo de exame: ${id}\n\n${corpus}`,
      maxTokens: 4000,
    });
    console.log(`${fmt(performance.now() - t0)} (custo ≈ US$ ${estimateCostUSD(config.llm.generationModel, r.usage).toFixed(3)})`);
    const out = join(regrasDir, `${id}.md`);
    writeFileSync(
      out,
      `<!-- RASCUNHO gerado automaticamente de ${files.length} laudos — REVISE e edite à vontade; o sistema usa este arquivo em toda geração desta máscara -->\n\n${r.text.trim()}\n`,
      'utf8',
    );
    console.log(`  → ${out}`);
  }
}

/**
 * Destila a MÁSCARA-CONSENSO de um tipo de exame a partir dos laudos sanitizados.
 * Uso: laudo destilar <id-novo> <PREFIXO1> [PREFIXO2…]  → rascunho em _rascunhos/
 */
async function destilar(id: string, prefixos: string[], filtro?: { contendo?: string; sem?: string }) {
  if (!id || prefixos.length === 0) throw new Error('uso: laudo destilar <id-novo> <PREFIXO1> [PREFIXO2…] [--contendo "…"] [--sem "…"]');
  requireEnv('ANTHROPIC_API_KEY');
  const config = loadConfig(APP_ROOT);
  const sanDir = sanitizedDir();
  const files = corpusFiles(sanDir, prefixos, 40, filtro);
  if (files.length === 0) throw new Error(`nenhum laudo sanitizado com prefixos ${prefixos.join(', ')}`);
  const corpus = files
    .map((f, i) => `─── LAUDO ${i + 1} ───\n${readFileSync(join(sanDir, f), 'utf8').trim()}`)
    .join('\n\n');
  const llm = new LLMClient();
  process.stdout.write(`Destilando ${id} de ${files.length} laudos… `);
  const t0 = performance.now();
  const r = await llm.complete({
    model: config.llm.generationModel,
    system: [{ text: DESTILAR_SYSTEM, cache: true }],
    user: `id: ${id}\nprefixos: [${prefixos.join(', ')}]\n\n${corpus}`,
    maxTokens: 2500,
  });
  console.log(`${fmt(performance.now() - t0)} (custo ≈ US$ ${estimateCostUSD(config.llm.generationModel, r.usage).toFixed(3)})`);
  const dir = join(config.masksDir, '_rascunhos');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${id}.md`);
  const text = r.text.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '');
  writeFileSync(out, `${text}\n`, 'utf8');
  console.log(`  → ${out} (rascunho — revisar e mover para a biblioteca)`);
}

/** Grava um comando de voz e o arquiva como caso do golden set, com teste imediato de seleção. */
async function novoCaso() {
  requireEnv('OPENAI_API_KEY');
  requireEnv('ANTHROPIC_API_KEY');
  const config = loadConfig(APP_ROOT);
  const masks = loadMasks(config);
  const goldenDir = resolve(APP_ROOT, 'eval', 'golden');
  const n = readdirSync(goldenDir).filter((f) => f.endsWith('.json')).length + 1;
  const id = `caso-${String(n).padStart(3, '0')}`;

  const audioPath = join(goldenDir, `${id}.wav`);
  await gravar(audioPath);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  process.stdout.write('Transcrevendo… ');
  const r = await stt.transcribe(audioPath);
  console.log(`${fmt(r.durationMs)}\n> "${r.text}"`);

  console.log('\nMáscaras:');
  masks.forEach((m, i) => console.log(`  ${i + 1}. ${m.id} — ${m.nome}`));
  console.log('  0. nenhuma (comando ambíguo de propósito)');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let esperada = '';
  while (!esperada) {
    const a = await new Promise<string>((res) =>
      rl.question('Máscara esperada (número ou id): ', (x) => res(x.trim())),
    );
    if (a === '0' || a.toLowerCase() === 'nenhuma') esperada = 'nenhuma';
    else if (/^\d+$/.test(a) && masks[Number(a) - 1]) esperada = masks[Number(a) - 1]!.id;
    else if (getMask(masks, a)) esperada = a;
    else console.log(`  "${a}" não é um número da lista nem um id válido — tente de novo.`);
  }
  rl.close();

  writeFileSync(
    join(goldenDir, `${id}.json`),
    JSON.stringify({ id, audio: `${id}.wav`, transcript_gravado: r.text, mask_esperada: esperada }, null, 2),
    'utf8',
  );

  const llm = new LLMClient();
  const sel = await selectMask(llm, config.llm.selectionModel, r.text, masks);
  const got = sel.mask?.id ?? 'nenhuma';
  console.log(
    `${got === esperada ? '✓ seleção correta' : `✗ seleção divergente (obtido: ${got})`} (confiança: ${sel.confianca})`,
  );
  console.log(`Caso salvo: eval/golden/${id}.json (áudio local, fora do git)`);
}

async function runEval() {
  const config = loadConfig(APP_ROOT);
  const masks = loadMasks(config);
  requireEnv('ANTHROPIC_API_KEY');
  const llm = new LLMClient();
  const goldenDir = resolve(APP_ROOT, 'eval', 'golden');
  const cases = readdirSync(goldenDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(goldenDir, f), 'utf8')));
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  let acertos = 0;
  let totalMs = 0;
  for (const c of cases) {
    let comando = c.comando as string | undefined;
    let sttMs = 0;
    if (!comando && c.audio) {
      requireEnv('OPENAI_API_KEY');
      const r = await stt.transcribe(join(goldenDir, c.audio));
      comando = r.text;
      sttMs = r.durationMs;
    }
    if (!comando) {
      console.log(`? ${c.id}: caso sem "comando" nem "audio" — pulado`);
      continue;
    }
    try {
      const sel = await selectMask(llm, config.llm.selectionModel, comando, masks);
      const got = sel.mask?.id ?? 'nenhuma';
      const ok = got === c.mask_esperada;
      if (ok) acertos++;
      totalMs += sttMs + sel.durationMs;
      console.log(
        `${ok ? '✓' : '✗'} ${c.id}: esperado=${c.mask_esperada} obtido=${got} (${sel.confianca}${c.audio ? `, stt ${fmt(sttMs)}` : ''}, seleção ${fmt(sel.durationMs)})`,
      );
    } catch (err) {
      console.log(`✗ ${c.id}: erro — ${err instanceof Error ? err.message : err}`);
    }
    if (c.audio) console.log(`   ouvido: "${comando}"`);
  }
  console.log(
    `\nSeleção: ${acertos}/${cases.length} (${((100 * acertos) / cases.length).toFixed(0)}%) | latência média ${fmt(totalMs / cases.length)}`,
  );
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const common = {
    maskId: flags.get('mask') as string | undefined,
    perfil: flags.get('perfil') as string | undefined,
    fast: Boolean(flags.get('fast')),
    sonnet: Boolean(flags.get('sonnet')),
    dryRun: Boolean(flags.get('dry-run')),
  };

  if (cmd === 'texto') {
    const transcript = positional.slice(1).join(' ');
    await runPipeline({ transcript, ...common });
  } else if (cmd === 'gravar') {
    const audioPath = await gravar();
    await runPipeline({ audioPath, ...common });
  } else if (cmd === 'caso') {
    await novoCaso();
  } else if (cmd === 'aprender') {
    await aprender(positional[1] ?? 'todos');
  } else if (cmd === 'destilar') {
    await destilar(positional[1] ?? '', positional.slice(2), {
      contendo: flags.get('contendo') as string | undefined,
      sem: flags.get('sem') as string | undefined,
    });
  } else if (cmd === 'eval') {
    await runEval();
  } else if (cmd === 'masks') {
    const masks = loadMasks(loadConfig(APP_ROOT));
    console.log(masks.map((m) => `${m.id} — ${m.nome} (v${m.versao}, ${m.origem})`).join('\n'));
  } else if (cmd && existsSync(cmd)) {
    await runPipeline({ audioPath: cmd, ...common });
  } else {
    console.log(
      'Uso:\n  npm run laudo -- texto "<comando>"\n  npm run laudo -- gravar\n  npm run laudo -- <arquivo de áudio>\n  npm run laudo -- masks\n  npm run eval\nFlags: --mask <id> --perfil <id> --fast --dry-run',
    );
  }
}

main().catch((err) => {
  console.error(`ERRO: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
