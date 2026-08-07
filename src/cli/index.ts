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
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import matter from 'gray-matter';
import { aplicarRascunho, descartarRascunho, listarRascunhos } from '../core/aprendizado/aplicar.js';
import { aprenderRegras } from '../core/aprendizado/aprender.js';
import { corpusPorPrefixosEmDirs } from '../core/aprendizado/corpus.js';
import { destilarMascara } from '../core/aprendizado/destilar.js';
import { loadConfig, type Config } from '../core/config/schema.js';
import { generate, selectMask } from '../core/engine/engine.js';
import { LLMClient, estimateCostUSD } from '../core/llm/anthropic.js';
import { chavesNecessarias, criarLLM } from '../core/llm/factory.js';
import { AVISO_BIBLIOTECA_VAZIA, bibliotecasDe, buildCatalog, contarMascaras, getMask, loadLibrary } from '../core/masks/library.js';
import { matchLocal, rankMasks } from '../core/masks/matcher.js';
import { formatarLaudo, prefsDoExame } from '../core/output/formatar.js';
import { copyToClipboard, saveReport, saveSidecar } from '../core/output/output.js';
import { sanitizeComando } from '../core/anonymizer/anonymizer.js';
import { OpenAISTT } from '../core/stt/openai.js';

const APP_ROOT = process.cwd();

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--fast' || a === '--dry-run' || a === '--sonnet' || a === '--kimi') flags.set(a.slice(2), true);
    else if (a === '--mask' || a === '--perfil' || a === '--contendo' || a === '--sem') flags.set(a.slice(2), argv[++i] ?? '');
    else positional.push(a);
  }
  return { flags, positional };
}

function loadMasks(config: ReturnType<typeof loadConfig>) {
  const camadas = bibliotecasDe(config);
  if (camadas.some((dir) => existsSync(dir))) {
    const masks = loadLibrary(camadas);
    if (contarMascaras(config.masksDir) === 0) console.warn(`AVISO: ${AVISO_BIBLIOTECA_VAZIA}`);
    return masks;
  }
  console.warn(`AVISO: nenhuma biblioteca encontrada (${camadas.join(', ')}) — usando masks-exemplo/`);
  return loadLibrary(resolve(APP_ROOT, 'masks-exemplo'));
}

import { loadProfile, loadRegras } from '../core/contexto.js';

function requireEnv(names: string[]): void {
  const faltando = names.filter((n) => !process.env[n]);
  if (faltando.length > 0) {
    console.error(
      `ERRO: variável(is) ${faltando.join(', ')} não definida(s). Crie um arquivo .env na pasta app/ com:\n${faltando
        .map((n) => `${n}=sua-chave-aqui`)
        .join('\n')}`,
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
  kimi?: boolean;
  dryRun?: boolean;
}) {
  const config = loadConfig(APP_ROOT);
  const masks = loadMasks(config);
  const profile = loadProfile(config, opts.perfil ?? config.perfilPadrao);
  let transcript = opts.transcript;
  let sttMs = 0;

  if (!transcript && opts.audioPath) {
    requireEnv(['OPENAI_API_KEY']);
    const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
    process.stdout.write('Transcrevendo… ');
    const r = await stt.transcribe(opts.audioPath);
    transcript = r.text;
    sttMs = r.durationMs;
    console.log(`${fmt(sttMs)}\n> "${transcript}"`);
  }
  if (!transcript) throw new Error('sem comando: use `texto "…"`, `gravar` ou um arquivo de áudio');

  const san = sanitizeComando(transcript);
  if (san.avisos.length > 0) console.warn(`⚠️  ${san.avisos.join(' | ')}`);
  transcript = san.texto;

  requireEnv(chavesNecessarias(config));

  if (opts.dryRun) {
    console.log('=== DRY RUN (nenhuma chamada de API) ===');
    console.log(`Comando: "${transcript}"`);
    console.log(`Perfil: ${profile.name}`);
    console.log(`\nCatálogo de seleção (${masks.length} máscaras):\n${buildCatalog(masks)}`);
    return;
  }

  const resolvido = criarLLM(config);

  // Seleção da máscara
  let mask = opts.maskId ? getMask(masks, opts.maskId) : undefined;
  let selMs = 0;
  let selCost: number | null = 0;
  let confianca = 'manual';
  if (!mask) {
    const local = matchLocal(transcript, masks);
    if (local) {
      mask = local;
      confianca = 'alta (seleção local, custo zero)';
    }
  }
  if (!mask) {
    const sel = await selectMask(resolvido.llm, resolvido.modelos.selecao, transcript, masks);
    selMs = sel.durationMs;
    selCost = estimateCostUSD(resolvido.modelos.selecao, sel.usage);
    confianca = sel.confianca;
    if (!sel.mask || sel.confianca === 'baixa') {
      console.error(`\nNão tive certeza do exame (confiança: ${sel.confianca}).`);
      console.error(`Máscaras disponíveis:\n${masks.map((m) => `  ${m.id} — ${m.nome}`).join('\n')}`);
      console.error(`\nRode de novo com --mask <id>.`);
      process.exit(2);
    }
    if (sel.confianca === 'media') {
      const sugerida = sel.mask;
      const candidatos = [sugerida, ...rankMasks(transcript, masks).filter((m) => m.id !== sugerida.id)].slice(0, 3);
      console.log('\nConfiança média — confirme o exame:');
      candidatos.forEach((m, k) => console.log(`  ${k + 1}. ${m.nome} [${m.id}]`));
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const resp = await new Promise<string>((res) =>
        rl.question(`ENTER confirma "${sugerida.nome}", ou digite número/id: `, (x) => res(x.trim())),
      );
      rl.close();
      if (resp) {
        const porNumero = /^\d+$/.test(resp) ? candidatos[Number(resp) - 1] : undefined;
        const escolhida = porNumero ?? getMask(masks, resp);
        if (!escolhida) {
          console.error(`"${resp}" não é um número da lista nem um id válido.`);
          process.exit(2);
        }
        mask = escolhida;
        confianca = 'manual';
      } else {
        mask = sugerida;
      }
    } else {
      mask = sel.mask;
    }
  }
  console.log(`Máscara: ${mask.nome} [${mask.id}] (confiança: ${confianca}, ${fmt(selMs)})`);

  // Geração
  let llm = resolvido.llm;
  let modeloGeracao = resolvido.modelos.geracao;
  if (opts.kimi) {
    requireEnv(['MOONSHOT_API_KEY']);
    llm = new LLMClient({
      apiKey: process.env['MOONSHOT_API_KEY'],
      baseURL: config.llm.kimiBaseURL,
      supportsCache: false,
    });
    modeloGeracao = config.llm.kimiModel;
  } else if (opts.sonnet) {
    requireEnv(['ANTHROPIC_API_KEY']); // modo qualidade é sempre Claude, mesmo no provedor openai
    llm = new LLMClient();
    modeloGeracao = 'claude-sonnet-5';
  } else if (opts.fast) {
    modeloGeracao = resolvido.modelos.rapido;
  }
  process.stdout.write(`Gerando laudo (${modeloGeracao})… `);
  const regras = loadRegras(config, mask.id);
  const gen = await generate(llm, {
    mask,
    transcript,
    profileName: profile.name,
    profileBody: profile.body,
    model: modeloGeracao,
    regras,
  });
  console.log(fmt(gen.durationMs));
  const genCost = estimateCostUSD(modeloGeracao, gen.usage);
  const custoNaoEstimado = selCost === null || genCost === null;

  // Saída — mesma formatação que o app entrega (camada pós-stripMarkers)
  const reportFinal = formatarLaudo(gen.report, prefsDoExame(config, mask.id));
  console.log('\n' + '─'.repeat(72) + '\n' + reportFinal + '\n' + '─'.repeat(72));
  if (gen.avisos.length > 0) console.warn(`⚠️  ${gen.avisos.join(' | ')}`);
  console.log(
    `Blocos alterados: ${gen.diff.changed.join(', ') || 'nenhum'} | preservados: ${gen.diff.kept.length}`,
  );
  const totalMs = sttMs + selMs + gen.durationMs;
  console.log(
    `Tempo total: ${fmt(totalMs)} (stt ${fmt(sttMs)} + seleção ${fmt(selMs)} + geração ${fmt(gen.durationMs)}) | custo LLM ${custoNaoEstimado ? 'não estimado (modelo fora da tabela)' : `≈ US$ ${((selCost ?? 0) + (genCost ?? 0)).toFixed(4)}`}`,
  );
  if (custoNaoEstimado) console.warn('⚠️  custo não estimado — o modelo configurado não está na tabela de preços');

  await copyToClipboard(reportFinal);
  console.log('✓ Copiado para a área de transferência');
  const saved = saveReport(config.outputDir, mask.id, reportFinal);
  saveSidecar(saved, {
    transcript,
    maskId: mask.id,
    perfil: profile.name,
    modelo: modeloGeracao,
    confianca,
    latenciasMs: { stt: Math.round(sttMs), selecao: Math.round(selMs), geracao: Math.round(gen.durationMs) },
    custoUSD: Number(((selCost ?? 0) + (genCost ?? 0)).toFixed(4)),
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

/**
 * Diretórios de laudos sanitizados a considerar, em ORDEM (mais recente/canônico por
 * último — o cap de `corpusPorPrefixosEmDirs` mantém preferencialmente o FIM da lista
 * combinada): o `tmp-sanitized` legado primeiro, depois `config.acervoDir` (novo, com
 * frontmatter de proveniência). Um médico legado pode ter os DOIS ao mesmo tempo (acervo
 * novo criado pelo wizard + laudos antigos nunca reimportados) — buscar só num dos dois
 * (como antes) fazia `aprender`/`destilar` acharem corpus zero para prefixos que só
 * existem no diretório preterido (ex.: `CRANIO_...` só no legado, mas `acervoDir` já não
 * está mais vazio por causa de outros exames). Lança só quando NENHUM dos dois existe.
 */
function sanitizedDirs(config: Config): string[] {
  const dirs: string[] = [];
  const legado = resolve(APP_ROOT, 'tmp-sanitized');
  if (existsSync(legado) && readdirSync(legado).length > 0) dirs.push(legado);
  if (existsSync(config.acervoDir) && readdirSync(config.acervoDir).length > 0) dirs.push(config.acervoDir);
  if (dirs.length === 0) {
    throw new Error('laudos sanitizados não encontrados — rode antes: npm run sanitize -- "../Modelos de Laudos/Exames_TC_2026"');
  }
  return dirs;
}

/** Formata o custo estimado no mesmo texto usado por todo o resto da CLI. */
function fmtCusto(custoUSD: number | null): string {
  return custoUSD === null ? 'não estimado' : `≈ US$ ${custoUSD.toFixed(3)}`;
}

/**
 * Camada de inteligência: lê os laudos SANITIZADOS do acervo e destila as
 * REGRAS DO MÉDICO (limites de protocolo, frasário patológico, estrutura) via
 * `core/aprendizado`. Casca fina: monta o corpus, delega ao core, imprime UX.
 */
async function aprender(target: string) {
  const config = loadConfig(APP_ROOT);
  requireEnv(chavesNecessarias(config));
  const masks = loadMasks(config);
  const sanDirs = sanitizedDirs(config);
  const alvo = target === 'todos' ? masks.filter((m) => m.prefixos.length > 0) : masks.filter((m) => m.id === target);
  if (alvo.length === 0) throw new Error(`nenhuma máscara com prefixos para "${target}"`);
  const { llm, modelos } = criarLLM(config);
  for (const m of alvo) {
    const id = m.id;
    const arquivos = corpusPorPrefixosEmDirs(sanDirs, m.prefixos, 60, { contendo: m.corpus_contendo, sem: m.corpus_sem });
    if (arquivos.length === 0) {
      console.warn(`nenhum laudo sanitizado para ${id} (prefixos: ${m.prefixos.join(', ')})`);
      continue;
    }
    process.stdout.write(`Aprendendo ${id} com ${arquivos.length} laudos… `);
    const t0 = performance.now();
    const r = await aprenderRegras({ maskId: id, arquivos, masksDir: config.masksDir }, { llm, modelo: modelos.geracao });
    console.log(`${fmt(performance.now() - t0)} (custo ${fmtCusto(r.custoUSD)})`);
    console.log(`  → rascunho: ${r.arquivo}`);
    console.log(`  revise e rode: laudo aplicar regras-${id}.md`);
  }
}

/**
 * Destila a MÁSCARA-CONSENSO de um tipo de exame a partir dos laudos sanitizados.
 * Uso: laudo destilar <id-novo> <PREFIXO1> [PREFIXO2…]  → rascunho em _rascunhos/
 */
async function destilar(id: string, prefixos: string[], filtro?: { contendo?: string; sem?: string }) {
  if (!id || prefixos.length === 0) throw new Error('uso: laudo destilar <id-novo> <PREFIXO1> [PREFIXO2…] [--contendo "…"] [--sem "…"]');
  const config = loadConfig(APP_ROOT);
  requireEnv(chavesNecessarias(config));
  const sanDirs = sanitizedDirs(config);
  const arquivos = corpusPorPrefixosEmDirs(sanDirs, prefixos, 40, filtro);
  if (arquivos.length === 0) throw new Error(`nenhum laudo sanitizado com prefixos ${prefixos.join(', ')}`);
  const { llm, modelos } = criarLLM(config);
  process.stdout.write(`Destilando ${id} de ${arquivos.length} laudos… `);
  const t0 = performance.now();
  const r = await destilarMascara({ id, arquivos, masksDir: config.masksDir, prefixos }, { llm, modelo: modelos.geracao });
  console.log(`${fmt(performance.now() - t0)} (custo ${fmtCusto(r.custoUSD)})`);
  console.log(`  → ${r.arquivo}`);
  console.log(`  revise e rode: laudo aplicar ${id}.md`);
}

/** Lista os rascunhos pendentes de `destilar`/`aprender` (`_rascunhos/`). */
function mostrarRascunhos() {
  const config = loadConfig(APP_ROOT);
  const rascunhos = listarRascunhos(config.masksDir);
  if (rascunhos.length === 0) {
    console.log('nenhum rascunho pendente em ' + join(config.masksDir, '_rascunhos'));
    return;
  }
  console.log(
    rascunhos
      .map((r) => `${r.arquivo}  [${r.tipo === 'mascara' ? 'máscara' : r.tipo === 'sintese' ? 'síntese' : 'regras'} → ${r.alvo}]`)
      .join('\n'),
  );
  console.log('\nlaudo aplicar <arquivo>   — promove para a biblioteca (com backup .bak se já existir)');
  console.log('laudo descartar <arquivo> — apaga o rascunho sem aplicar');
}

/** Promove um rascunho (`_rascunhos/<arquivo>`) para a biblioteca, com backup se já existir destino. */
function aplicar(arquivo: string) {
  if (!arquivo) throw new Error('uso: laudo aplicar <arquivo>  (veja os pendentes com `laudo rascunhos`)');
  const config = loadConfig(APP_ROOT);
  const r = aplicarRascunho(config.masksDir, arquivo);
  console.log(`✓ aplicado em ${r.destino}`);
  if (r.backup) console.log(`  (versão anterior preservada em ${r.backup})`);
}

/** Descarta um rascunho (`_rascunhos/<arquivo>`) sem aplicá-lo. */
function descartar(arquivo: string) {
  if (!arquivo) throw new Error('uso: laudo descartar <arquivo>  (veja os pendentes com `laudo rascunhos`)');
  const config = loadConfig(APP_ROOT);
  descartarRascunho(config.masksDir, arquivo);
  console.log(`✓ descartado: ${arquivo}`);
}

/** Grava um comando de voz e o arquiva como caso do golden set, com teste imediato de seleção. */
async function novoCaso() {
  const config = loadConfig(APP_ROOT);
  requireEnv(['OPENAI_API_KEY']); // sempre grava e transcreve, independente do provedor de LLM
  requireEnv(chavesNecessarias(config));
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
  const san = sanitizeComando(r.text);
  if (san.avisos.length > 0) console.warn(`⚠️  ${san.avisos.join(' | ')}`);

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
    JSON.stringify({ id, audio: `${id}.wav`, transcript_gravado: san.texto, mask_esperada: esperada }, null, 2),
    'utf8',
  );

  const { llm, modelos } = criarLLM(config);
  const sel = await selectMask(llm, modelos.selecao, san.texto, masks);
  const got = sel.mask?.id ?? 'nenhuma';
  console.log(
    `${got === esperada ? '✓ seleção correta' : `✗ seleção divergente (obtido: ${got})`} (confiança: ${sel.confianca})`,
  );
  console.log(`Caso salvo: eval/golden/${id}.json (áudio local, fora do git)`);
}

async function runEval() {
  const config = loadConfig(APP_ROOT);
  const masks = loadMasks(config);
  requireEnv(chavesNecessarias(config));
  const { llm, modelos } = criarLLM(config);
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
      requireEnv(['OPENAI_API_KEY']);
      const r = await stt.transcribe(join(goldenDir, c.audio));
      comando = r.text;
      sttMs = r.durationMs;
    }
    if (!comando) {
      console.log(`? ${c.id}: caso sem "comando" nem "audio" — pulado`);
      continue;
    }
    const sanCaso = sanitizeComando(comando);
    if (sanCaso.avisos.length > 0) console.warn(`⚠️  ${c.id}: ${sanCaso.avisos.join(' | ')}`);
    comando = sanCaso.texto;
    try {
      const sel = await selectMask(llm, modelos.selecao, comando, masks);
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
    kimi: Boolean(flags.get('kimi')),
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
  } else if (cmd === 'rascunhos') {
    mostrarRascunhos();
  } else if (cmd === 'aplicar') {
    aplicar(positional[1] ?? '');
  } else if (cmd === 'descartar') {
    descartar(positional[1] ?? '');
  } else if (cmd && existsSync(cmd)) {
    await runPipeline({ audioPath: cmd, ...common });
  } else {
    console.log(
      'Uso:\n  npm run laudo -- texto "<comando>"\n  npm run laudo -- gravar\n  npm run laudo -- <arquivo de áudio>\n  npm run laudo -- masks\n  npm run laudo -- destilar <id-novo> <PREFIXO1> [PREFIXO2…]\n  npm run laudo -- aprender [<id>|todos]\n  npm run laudo -- rascunhos\n  npm run laudo -- aplicar <arquivo>\n  npm run laudo -- descartar <arquivo>\n  npm run eval\nFlags: --mask <id> --perfil <id> --fast --dry-run',
    );
  }
}

main().catch((err) => {
  console.error(`ERRO: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
