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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import matter from 'gray-matter';
import { loadConfig } from '../core/config/schema.js';
import { generate, selectMask } from '../core/engine/engine.js';
import { LLMClient, estimateCostUSD } from '../core/llm/anthropic.js';
import { buildCatalog, getMask, loadLibrary } from '../core/masks/library.js';
import { copyToClipboard, saveReport, saveSidecar } from '../core/output/output.js';
import { OpenAISTT } from '../core/stt/openai.js';

const APP_ROOT = process.cwd();

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--fast' || a === '--dry-run') flags.set(a.slice(2), true);
    else if (a === '--mask' || a === '--perfil') flags.set(a.slice(2), argv[++i] ?? '');
    else positional.push(a);
  }
  return { flags, positional };
}

function loadMasks(config: ReturnType<typeof loadConfig>) {
  if (existsSync(config.masksDir)) return loadLibrary(config.masksDir);
  console.warn(`AVISO: biblioteca não encontrada em ${config.masksDir} — usando masks-exemplo/`);
  return loadLibrary(resolve(APP_ROOT, 'masks-exemplo'));
}

function loadProfile(config: ReturnType<typeof loadConfig>, id: string) {
  const path = join(config.profilesDir, `${id}.md`);
  if (!existsSync(path)) throw new Error(`perfil não encontrado: ${id}`);
  const { data, content } = matter(readFileSync(path, 'utf8'));
  return { name: (data.nome as string) ?? id, body: content.trim() };
}

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
  const genModel = opts.fast ? config.llm.fastModel : config.llm.generationModel;
  process.stdout.write(`Gerando laudo (${genModel})… `);
  const gen = await generate(llm, {
    mask,
    transcript,
    profileName: profile.name,
    profileBody: profile.body,
    model: genModel,
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

  console.log(`\nMáscaras: ${masks.map((m) => m.id).join(', ')}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const esperada = await new Promise<string>((res) =>
    rl.question('Máscara esperada (id, ou "nenhuma" se o comando é ambíguo de propósito): ', (a) => {
      rl.close();
      res(a.trim());
    }),
  );

  const { writeFileSync } = await import('node:fs');
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
    const sel = await selectMask(llm, config.llm.selectionModel, comando, masks);
    const got = sel.mask?.id ?? 'nenhuma';
    const ok = got === c.mask_esperada;
    if (ok) acertos++;
    totalMs += sttMs + sel.durationMs;
    console.log(
      `${ok ? '✓' : '✗'} ${c.id}: esperado=${c.mask_esperada} obtido=${got} (${sel.confianca}${c.audio ? `, stt ${fmt(sttMs)}` : ''}, seleção ${fmt(sel.durationMs)})`,
    );
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
