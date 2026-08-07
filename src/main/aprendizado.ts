/**
 * Orquestração do aprendizado (Bloco 3, T5+T7): estimativa de custo (SEM LLM) e
 * execução (COM LLM, gate BYOK, sequencial, cancelável) de `destilar`/`aprender`;
 * mais "Meu estilo" — leitura/gravação dos itens da biblioteca do médico
 * (máscaras/regras/frasário), que é o mesmo diretório que os rascunhos gerados
 * aqui acabam promovendo (`aplicarRascunho`, em core/aprendizado/aplicar.ts);
 * mais o corpus do "Reaprender" (T7) — junta o acervo já sanitizado com a
 * edição final do médico no histórico (sinal de estilo mais puro).
 *
 * Progresso via `onProgresso` — o chamador (main/index.ts) repassa a TODAS as
 * janelas vivas via `webContents.send` (mesmo padrão do canal `estado`).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import matter from 'gray-matter';
import { corpoDoArquivo } from '../core/acervo/sanitizar.js';
import { sanitize } from '../core/anonymizer/anonymizer.js';
import { writeFileAtomicSync } from '../core/atomic-write.js';
import { validarNomeRascunho } from '../core/aprendizado/aplicar.js';
import { aprenderRegras } from '../core/aprendizado/aprender.js';
import { corpusPorArquivos, corpusPorPrefixos, montarCorpus } from '../core/aprendizado/corpus.js';
import { estimarCustoAprendizado } from '../core/aprendizado/custo.js';
import { destilarMascara } from '../core/aprendizado/destilar.js';
import { destilarSintese } from '../core/aprendizado/sintese.js';
import type { Config } from '../core/config/schema.js';
import { criarLLM, modelosDe } from '../core/llm/factory.js';
import { bibliotecasDe, loadLibrary } from '../core/masks/library.js';
import { MaskFrontmatterSchema } from '../core/masks/schema.js';
import { amostraAleatoria } from './acervo.js';
import { exigirChaves } from './pipeline.js';

export interface AlvoAprendizado {
  tipo: 'destilar' | 'aprender' | 'sintetizar';
  /** Chave do cluster do acervo (identifica o alvo para o wizard/progresso — não é usada em caminho de arquivo). */
  chave: string;
  /** Id da máscara: existente (aprender/sintetizar) ou nova (destilar). */
  maskId: string;
  arquivos: string[];
}

// Espelha o `maxTokens` usado internamente por destilarMascara/aprenderRegras/destilarSintese
// (core/aprendizado/{destilar,aprender,sintese}.ts) — mantenha em sincronia se mudar lá.
const MAX_TOKENS_DESTILAR = 2500;
const MAX_TOKENS_APRENDER = 4000;
const MAX_TOKENS_SINTETIZAR = 3000;

function maxTokensDe(tipo: AlvoAprendizado['tipo']): number {
  if (tipo === 'destilar') return MAX_TOKENS_DESTILAR;
  if (tipo === 'sintetizar') return MAX_TOKENS_SINTETIZAR;
  return MAX_TOKENS_APRENDER;
}

// Cap de laudos por alvo efetivamente enviados a um LLM — mesmo valor usado pelo `laudo
// aprender todos` da CLI (`corpus.ts`) e por `montarAlvosReaprender`. `montarAlvosReaprender`
// já aplica este cap ao montar seus alvos, mas o wizard de importação normal (T6) NÃO cap(a)
// os arquivos de um cluster antes de montar `AlvoAprendizado` — um cluster grande (ex.: 500+
// laudos de abdome) ia inteiro para a estimativa e para a execução (I1). Aplicado no MESMO
// ponto (`arquivosComCap`) tanto por `estimarAprendizado` quanto por `rodarAprendizado`, para a
// estimativa nunca mentir sobre o corpus que de fato será enviado.
const CAP_ARQUIVOS_POR_ALVO = 60;

/** Últimos `CAP_ARQUIVOS_POR_ALVO` arquivos de um alvo (peso de recência) — ver `CAP_ARQUIVOS_POR_ALVO`. */
function arquivosComCap(arquivos: string[]): string[] {
  return corpusPorArquivos(arquivos, CAP_ARQUIVOS_POR_ALVO);
}

export interface EstimativaAprendizado {
  porAlvo: { chave: string; custoAproxUSD: number | null }[];
  totalUSD: number | null;
}

/**
 * Estimativa de custo ANTES de qualquer chamada de LLM — só lê os arquivos
 * localmente (via `corpusPorArquivos`/`montarCorpus`, reuso do core), já com o
 * MESMO cap (`arquivosComCap`) aplicado pela execução (I1) — sem isso, um
 * cluster grande estourava a estimativa (e o corpus real enviado ao LLM) bem
 * além do que o médico via na tela de custo. NÃO exige chaves configuradas:
 * usa `modelosDe` (ajuste de compatibilidade puro, sem instanciar provider)
 * em vez de `criarLLM` (que, no provedor 'openai', lança se a chave estiver
 * ausente — comportamento indesejado numa estimativa que deve funcionar sem
 * BYOK) — mesmo modelo que `rodarAprendizado` de fato vai usar (M4).
 */
export function estimarAprendizado(alvos: AlvoAprendizado[], config: Config): EstimativaAprendizado {
  const modelo = modelosDe(config).geracao;
  const porAlvo = alvos.map((alvo) => {
    try {
      const arquivos = arquivosComCap(alvo.arquivos);
      const { corpus } = montarCorpus(arquivos);
      const bytes = Buffer.byteLength(corpus, 'utf8');
      const { custoAproxUSD } = estimarCustoAprendizado(bytes, modelo, maxTokensDe(alvo.tipo));
      return { chave: alvo.chave, custoAproxUSD };
    } catch {
      return { chave: alvo.chave, custoAproxUSD: null };
    }
  });
  const totalConhecido = porAlvo.every((p) => p.custoAproxUSD !== null);
  const totalUSD = totalConhecido ? porAlvo.reduce((soma, p) => soma + (p.custoAproxUSD ?? 0), 0) : null;
  return { porAlvo, totalUSD };
}

// ── Execução (com LLM) ───────────────────────────────────────────────────────

let canceladoFlag = false;
let emExecucao = false;

/** Sinaliza o cancelamento do lote em andamento (flag de módulo — checada pelo core antes de cada LLM). */
export function cancelarAprendizado(): void {
  canceladoFlag = true;
}

/** Há um lote de `rodarAprendizado` em andamento agora? Usado pelo `main/index.ts` para NÃO
 *  varrer tempdirs do corpus do histórico (`limparCorpusHistoricoOrfao`) enquanto um lote real
 *  ainda pode estar lendo algum deles — evitaria uma corrida rara (ENOENT no meio da leitura)
 *  se a janela de importação fechasse durante uma execução em segundo plano (I2). */
export function aprendizadoEmExecucao(): boolean {
  return emExecucao;
}

export interface ResultadoAprendizadoLote {
  ok: { chave: string; arquivo: string; custoUSD: number }[];
  falhas: { chave: string; erro: string }[];
}

/**
 * Roda os alvos EM SEQUÊNCIA (custo previsível — nunca paralelo). Gate
 * `exigirChaves` roda ANTES de qualquer outra coisa (inclusive antes de
 * `criarLLM`, que para o provedor 'openai' já lança sem chave configurada).
 *
 * Cancelamento: `canceladoFlag` é checada no TOPO do laço — nenhum alvo NOVO
 * começa depois de cancelar (interrompe de fato o lote). Um alvo já em
 * andamento só para no próximo checkpoint interno do core (`cancelado?.()`,
 * checado ali antes da chamada ao LLM) e sua falha entra em `falhas` como
 * qualquer outra. Falha de um alvo isolado nunca interrompe os demais.
 *
 * Cada `alvo.arquivos` passa por `arquivosComCap` (I1) ANTES de ir para
 * `destilarMascara`/`aprenderRegras` — mesmo cap e mesmo ponto usado por
 * `estimarAprendizado`, então a estimativa mostrada ao médico bate com o
 * corpus de fato enviado (o wizard de importação normal, ao contrário de
 * `montarAlvosReaprender`, não capava os arquivos de um cluster antes).
 *
 * Higiene de privacidade: se algum `alvo.arquivos` vier de `corpusDoHistorico`
 * (Reaprender — arquivos temporários fora de `outputDir`), esses diretórios
 * são apagados no `finally`, DEPOIS que todo o lote terminou (sucesso, falha
 * OU cancelamento — o corpus já foi lido por `montarCorpus` a essa altura, não
 * precisa sobreviver) — MAS só se o gate `exigirChaves` passou (`leuCorpus`):
 * se ele falhar ANTES do laço, o corpus nunca chegou a ser lido, e apagar os
 * tempdirs aqui deixaria um retry (depois de configurar a chave, com o MESMO
 * plano montado na tela) achando ENOENT (I2). Quem cobre esse caso (chave
 * nunca configurada, médico fecha a janela em vez de tentar de novo) é o
 * sweep de `limparCorpusHistoricoOrfao` — chamado no boot e no `closed` da
 * janela de importação (`main/index.ts`).
 */
export async function rodarAprendizado(
  alvos: AlvoAprendizado[],
  config: Config,
  onProgresso?: (p: { chave: string; etapa: string; atual: number; total: number }) => void,
): Promise<ResultadoAprendizadoLote> {
  if (emExecucao) throw new Error('já existe um aprendizado em andamento — aguarde terminar ou cancele antes de iniciar outro');
  const tempDirsHistorico = tempDirsDoCorpusHistorico(alvos);
  emExecucao = true;
  let leuCorpus = false; // só vira true DEPOIS que o gate de chaves passa (ver docstring)
  try {
    exigirChaves(config); // gate ANTES de qualquer LLM (inclusive antes de criarLLM)
    leuCorpus = true;
    const { llm, modelos } = criarLLM(config);

    canceladoFlag = false;
    const ok: ResultadoAprendizadoLote['ok'] = [];
    const falhas: ResultadoAprendizadoLote['falhas'] = [];
    for (const alvo of alvos) {
      if (canceladoFlag) break; // interrompe de fato: nenhum alvo novo começa após cancelar
      const arquivos = arquivosComCap(alvo.arquivos);
      const opts = {
        llm,
        modelo: modelos.geracao,
        onProgresso: (p: { etapa: string; atual: number; total: number }) => onProgresso?.({ chave: alvo.chave, ...p }),
        cancelado: () => canceladoFlag,
      };
      try {
        const r =
          alvo.tipo === 'destilar'
            ? // `prefixos: [alvo.maskId]` — os arquivos do acervo deste cluster são gravados como
              // `<maskId>_<data>_<nnn>.md` (ver `sanitizarParaAcervo`), então o próprio maskId É o
              // prefixo correto; sem isso o frontmatter `prefixos:` da máscara destilada saía
              // vazio e `montarAlvosReaprender`/o `laudo aprender` da CLI nunca achavam este
              // cluster de novo pelo acervo (C1).
              await destilarMascara({ id: alvo.maskId, arquivos, masksDir: config.masksDir, prefixos: [alvo.maskId] }, opts)
            : alvo.tipo === 'sintetizar'
              ? await destilarSintese({ maskId: alvo.maskId, arquivos, masksDir: config.masksDir }, opts)
              : await aprenderRegras({ maskId: alvo.maskId, arquivos, masksDir: config.masksDir }, opts);
        ok.push({ chave: alvo.chave, arquivo: r.arquivo, custoUSD: r.custoUSD ?? 0 });
      } catch (err) {
        falhas.push({ chave: alvo.chave, erro: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ok, falhas };
  } finally {
    emExecucao = false;
    if (leuCorpus) limparTempDirsDoCorpus(tempDirsHistorico);
  }
}

// ── Meu estilo (leitura/gravação da biblioteca do médico) ───────────────────

export interface ItemEstiloMascara {
  id: string;
  nome: string;
  origemEfetiva: 'base' | 'minha';
}

/** Regra ou frase do frasário: `nome` é o identificador (sem `.md`) usado por `estiloLer`/`estiloSalvar`. */
export interface ItemEstilo {
  nome: string;
  origemEfetiva: 'base' | 'minha';
}

/** Tipos de item editáveis no "Meu estilo" — `sintese` é a tabela manual dos pares
 *  corpo → conclusão (`regras/sintese-<id>.md`, grupo próprio na UI, `nome` = id do exame). */
export type TipoEstilo = 'mascara' | 'regras' | 'frasario' | 'sintese';

export interface ResumoEstilo {
  mascaras: ItemEstiloMascara[];
  regras: ItemEstilo[];
  /** Síntese da conclusão por exame — arquivos `regras/sintese-*.md`, `nome` SEM o prefixo. */
  sintese: ItemEstilo[];
  frasario: ItemEstilo[];
}

/** Nomes (sem `.md`) dos arquivos de um diretório; `[]` se ausente. */
function nomesSemExtensao(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

/** União base+médico com a origem EFETIVA de cada nome (médico vence — mesmo critério de `lerEstilo`). */
function itensComOrigem(baseDir: string, medicoDir: string): ItemEstilo[] {
  const doMedico = new Set(nomesSemExtensao(medicoDir));
  const todos = new Set([...nomesSemExtensao(baseDir), ...doMedico]);
  return [...todos].sort().map((nome) => ({ nome, origemEfetiva: doMedico.has(nome) ? 'minha' : 'base' }));
}

/** Catálogo do "Meu estilo": máscaras/regras/frasário efetivos, cada um com a origem (base vs. médico). */
export function listarEstilo(config: Config): ResumoEstilo {
  let masks: ReturnType<typeof loadLibrary> = [];
  try {
    masks = loadLibrary(bibliotecasDe(config));
  } catch {
    /* biblioteca vazia (raro) — tela mostra "nenhuma máscara" em vez de quebrar */
  }
  const mascaras = masks.map((m) => ({
    id: m.id,
    nome: m.nome,
    origemEfetiva: (existsSync(join(config.masksDir, `${m.id}.md`)) ? 'minha' : 'base') as 'base' | 'minha',
  }));
  // Síntese mora na MESMA pasta `regras/` com o prefixo `sintese-` (é onde `loadRegras` a lê),
  // mas na UI é um grupo PRÓPRIO — a "tabela manual" dos pares corpo → conclusão. Separa aqui
  // e expõe o `nome` SEM o prefixo (o id do exame), como `lerEstilo`/`salvarEstilo` esperam
  // para o tipo 'sintese'.
  const regrasTodas = itensComOrigem(join(config.bibliotecaBaseDir, 'regras'), join(config.masksDir, 'regras'));
  const regras = regrasTodas.filter((r) => !r.nome.startsWith('sintese-'));
  const sintese = regrasTodas
    .filter((r) => r.nome.startsWith('sintese-'))
    .map((r) => ({ ...r, nome: r.nome.slice('sintese-'.length) }));
  const frasario = itensComOrigem(join(config.bibliotecaBaseDir, 'frasario'), join(config.masksDir, 'frasario'));
  return { mascaras, regras, sintese, frasario };
}

/** Caminho relativo (dentro de uma camada) do item — `nome` já validado pelo chamador. */
function caminhoRelativoDe(tipo: TipoEstilo, nome: string): string {
  if (tipo === 'mascara') return `${nome}.md`;
  if (tipo === 'sintese') return join('regras', `sintese-${nome}.md`); // mesmo caminho que loadRegras lê
  return join(tipo, `${nome}.md`);
}

/**
 * Lê o conteúdo EFETIVO do item (médico vence a base). `nome` passa por
 * `validarNomeRascunho` — mesma barreira antitraversal usada pelos rascunhos
 * (rejeita `/`, `\`, `.`, `..`; reuso deliberado, a validação é genérica).
 */
export function lerEstilo(config: Config, tipo: TipoEstilo, nome: string): string {
  validarNomeRascunho(nome);
  const rel = caminhoRelativoDe(tipo, nome);
  const doMedico = join(config.masksDir, rel);
  const daBase = join(config.bibliotecaBaseDir, rel);
  const caminho = existsSync(doMedico) ? doMedico : daBase;
  if (!existsSync(caminho)) throw new Error(`${tipo} não encontrado(a): ${nome}`);
  return readFileSync(caminho, 'utf8');
}

/**
 * Grava SEMPRE na biblioteca do médico (`masksDir`), atômico — editar um item
 * que hoje só existe na base cria um override lá (próxima leitura já vem dele).
 * Frontmatter validado (zod) quando `tipo === 'mascara'`, ANTES de tocar o
 * disco — mesma checagem usada por `aplicarRascunho` para promoção de rascunho.
 */
export function salvarEstilo(config: Config, tipo: TipoEstilo, nome: string, texto: string): void {
  validarNomeRascunho(nome);
  if (tipo === 'mascara') {
    const { data } = matter(texto);
    const parsed = MaskFrontmatterSchema.safeParse(data);
    if (!parsed.success) {
      const motivos = parsed.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
      throw new Error(`máscara inválida — não gravada: ${motivos}`);
    }
    if (parsed.data.id !== nome) {
      throw new Error(`o campo "id" do frontmatter (${parsed.data.id}) precisa ser igual ao nome do item (${nome})`);
    }
  }
  const destino = join(config.masksDir, caminhoRelativoDe(tipo, nome));
  mkdirSync(dirname(destino), { recursive: true });
  writeFileAtomicSync(destino, texto);
}

// ── Reaprender com meus laudos (T7): corpus do histórico editado ────────────

// Prefixo dos diretórios temporários do corpus do histórico dentro de `tmpdir()` — usado tanto
// para CRIAR (`corpusDoHistorico`) quanto para RECONHECER e limpar (`limparTempDirsDoCorpus`,
// `limparCorpusHistoricoOrfao`) E validar (`arquivoPermitidoParaAprendizado`, I5). Esses
// diretórios não têm política de retenção própria como o spool de áudio (cifrado, ≤48 h) — são
// só texto já sanitizado, mas mesmo assim não devem acumular para sempre no temp do SO (higiene
// de privacidade). Exportado para `main/index.ts` não duplicar a string mágica.
export const PREFIXO_TMP_CORPUS_HISTORICO = 'aerolince-corpus-historico-';

export interface ItemCorpusHistorico {
  /** Máscara à qual este laudo do histórico pertence (sidecar `maskId`) — usada para juntar ao alvo certo do "Reaprender". */
  maskId: string;
  /** Caminho ABSOLUTO de um arquivo TEMPORÁRIO (fora de `outputDir`, nunca versionado) com o texto final RE-SANITIZADO. */
  arquivo: string;
}

/**
 * Corpus do "Reaprender com meus laudos": a edição final do médico no
 * histórico (`laudoFinalEditado`) é o sinal de estilo mais puro (decisão 6 /
 * item 1 do backlog antigo) — mais direto que qualquer laudo do acervo, porque
 * é o próprio médico corrigindo a saída do app.
 *
 * Varre os sidecars de `outputDir`, filtra os que têm `laudoFinalEditado`
 * (ignora sidecar ausente/corrompido ou sem edição), RE-SANITIZA o texto final
 * com `sanitize().clean` — regra de privacidade: NENHUM texto do histórico vai
 * a um LLM sem passar de novo pelo anonimizador local, mesmo já tendo sido
 * sanitizado uma vez — e grava cada um num arquivo `.md` TEMPORÁRIO (fora de
 * `outputDir`/git) para reusar o mesmo pipeline de corpus de qualquer arquivo
 * do acervo (`corpoDoArquivo`/`montarCorpus`, que também re-sanitizam, defesa
 * em profundidade). `cap` mantém só os mais recentes — nomes de arquivo datados
 * (`AAAA-MM-DD_HHMM_...`) tornam a ordem lexicográfica cronológica.
 */
export function corpusDoHistorico(outputDir: string, cap = 40): ItemCorpusHistorico[] {
  if (!existsSync(outputDir)) return [];
  const editados: { maskId: string; texto: string }[] = [];
  for (const f of readdirSync(outputDir).filter((f) => f.endsWith('.txt')).sort()) {
    const sidecarPath = join(outputDir, f.replace(/\.txt$/, '.json'));
    if (!existsSync(sidecarPath)) continue;
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    } catch {
      continue; // sidecar corrompido — não entra no corpus
    }
    const final = meta.laudoFinalEditado;
    if (typeof final !== 'string' || !final.trim()) continue;
    const maskId = typeof meta.maskId === 'string' && meta.maskId ? meta.maskId : 'desconhecido';
    editados.push({ maskId, texto: final });
  }
  const recentes = editados.slice(-cap);
  if (recentes.length === 0) return [];
  // NÃO fica órfão para sempre: quem consome estes arquivos (`rodarAprendizado`) apaga o
  // diretório inteiro no `finally`, depois que o corpus já foi lido; `limparCorpusHistoricoOrfao`
  // (chamada no boot) cobre o caso de a sessão nunca ter chegado a rodar o aprendizado.
  const dir = mkdtempSync(join(tmpdir(), PREFIXO_TMP_CORPUS_HISTORICO));
  return recentes.map(({ maskId, texto }, i) => {
    const { clean } = sanitize(texto); // re-sanitização obrigatória, mesmo já vindo do pipeline sanitizado
    const destino = join(dir, `${maskId}_${String(i).padStart(3, '0')}.md`);
    writeFileSync(destino, clean, 'utf8');
    return { maskId, arquivo: destino };
  });
}

/**
 * Diretórios temporários do corpus do histórico (prefixo `PREFIXO_TMP_CORPUS_HISTORICO` dentro
 * de `tmpdir()`) referenciados pelos arquivos de um lote de alvos — identificados pelo próprio
 * caminho, sem precisar de um registro à parte: todo arquivo de `corpusDoHistorico` mora
 * DIRETAMENTE dentro de um diretório assim, então basta olhar o pai de cada `arquivo`.
 */
function tempDirsDoCorpusHistorico(alvos: AlvoAprendizado[]): Set<string> {
  const raiz = tmpdir();
  const dirs = new Set<string>();
  for (const alvo of alvos) {
    for (const arquivo of alvo.arquivos) {
      const pai = dirname(arquivo);
      if (dirname(pai) === raiz && basename(pai).startsWith(PREFIXO_TMP_CORPUS_HISTORICO)) dirs.add(pai);
    }
  }
  return dirs;
}

/** Apaga os diretórios temporários do corpus do histórico depois de consumidos. Best-effort — uma falha aqui nunca deve mascarar o resultado do aprendizado. */
function limparTempDirsDoCorpus(dirs: Iterable<string>): void {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort — o SO eventualmente limpa tmpdir(); não é motivo para lançar */
    }
  }
}

/**
 * Varre `tmpdir()` por diretórios órfãos do corpus do histórico (`aerolince-corpus-historico-*`)
 * de sessões anteriores que nunca chegaram a rodar `rodarAprendizado` (fechou a janela do
 * Reaprender só depois de ver o custo, crash do app, etc.) — mesma ideia do recovery do spool de
 * áudio, chamada uma vez no boot. Best-effort: nunca deve travar o boot. Devolve quantos
 * diretórios foram removidos (só para log/teste).
 */
export function limparCorpusHistoricoOrfao(): number {
  const raiz = tmpdir();
  let nomes: string[];
  try {
    nomes = readdirSync(raiz);
  } catch {
    return 0; // tmpdir() inacessível — nunca travar o boot por causa disso
  }
  let removidos = 0;
  for (const nome of nomes) {
    if (!nome.startsWith(PREFIXO_TMP_CORPUS_HISTORICO)) continue;
    try {
      rmSync(join(raiz, nome), { recursive: true, force: true });
      removidos++;
    } catch {
      /* best-effort — segue para o próximo */
    }
  }
  return removidos;
}

// ── Confinamento de caminhos na fronteira IPC (I5) ───────────────────────────

/** `caminho` está dentro de `dirBase` (ou é o próprio `dirBase`)? Resolve os dois antes de
 *  comparar — normaliza `..`/segmentos relativos, então um `../../etc/passwd` disfarçado não
 *  escapa da checagem por comparação textual ingênua. */
function dentroDe(caminho: string, dirBase: string): boolean {
  const alvo = resolve(caminho);
  const base = resolve(dirBase);
  return alvo === base || alvo.startsWith(base + sep);
}

/**
 * Um `arquivo` citado por um `AlvoAprendizado` vindo do RENDERER pode entrar em
 * `estimarAprendizado`/`rodarAprendizado`, que leem o conteúdo e (na execução) mandam para um
 * LLM — a fronteira IPC (`main/index.ts`) não pode confiar que o renderer só aponte para onde
 * deveria (`acervo-importar`/`reaprender-montar-alvos` já resolvem os caminhos certos, mas nada
 * impede um renderer comprometido, ou um bug futuro, de mandar QUALQUER caminho absoluto do
 * disco do médico). Permitido só dentro de `acervoDir` (onde o acervo sanitizado mora) OU de um
 * tempdir do corpus do histórico (dentro de `tmpdir()`, com o prefixo `PREFIXO_TMP_CORPUS_HISTORICO`,
 * criado por `corpusDoHistorico`) — qualquer outro caminho é rejeitado.
 */
export function arquivoPermitidoParaAprendizado(arquivo: string, acervoDir: string): boolean {
  if (dentroDe(arquivo, acervoDir)) return true;
  const raizTemp = resolve(tmpdir());
  const alvo = resolve(arquivo);
  if (alvo !== raizTemp && !alvo.startsWith(raizTemp + sep)) return false;
  const primeiroSegmento = alvo.slice(raizTemp.length + 1).split(sep)[0] ?? '';
  return primeiroSegmento.startsWith(PREFIXO_TMP_CORPUS_HISTORICO);
}

export interface ResumoReaprender {
  alvos: AlvoAprendizado[];
  /** Máscaras com `prefixos` configurados mas sem nenhum laudo disponível ainda (nem acervo, nem histórico editado). */
  semArquivos: { maskId: string; nome: string }[];
  /**
   * Ao menos um alvo inclui laudos do HISTÓRICO EDITADO (não só do acervo, cujo consentimento
   * já foi dado no wizard de importação original) — sinaliza à janela do "Reaprender" (I3) que
   * o passo de consentimento precisa aparecer antes de liberar "Aprender meu estilo": o
   * histórico é um corpus novo, que o médico nunca viu nem autorizou explicitamente antes.
   */
  temHistorico: boolean;
  /** Até 3 amostras sanitizadas (dos arquivos que os alvos vão enviar) para o passo de
   *  consentimento do "Reaprender" — mesmo papel das amostras da importação normal. */
  amostras: { arquivo: string; texto: string }[];
}

/**
 * Monta os alvos do botão "Reaprender com meus laudos" (janela Meu Estilo):
 * para CADA máscara da biblioteca (base + médico), junta os laudos já
 * sanitizados no ACERVO (`corpusPorPrefixos`, casando por `[m.id, ...m.prefixos]`
 * — não só `m.prefixos`) com os do HISTÓRICO EDITADO (`corpusDoHistorico`) que
 * pertencem à mesma máscara (por `maskId`, sempre). Casar por `m.id` também é
 * essencial (C1): TODA a biblioteca-base e as máscaras destiladas pelo wizard
 * têm `prefixos: []`, mas os arquivos do acervo de um cluster são gravados como
 * `<maskId>_<data>_<nnn>.md` — sem casar pelo id, "Reaprender" nunca achava
 * esses laudos e sempre dizia "nenhum laudo".
 *
 * O histórico entra no FIM da lista — como o cap de `corpusPorArquivos` corta
 * pelo INÍCIO (`slice(-cap)`), a edição do médico tem prioridade sobre o
 * acervo mais antigo quando o total excede o cap (peso de recência). Gera
 * alvos `'aprender'` (fraseado) e `'sintetizar'` (pares de síntese da
 * conclusão) de máscaras já existentes — "Reaprender" refina o estilo, não
 * descobre máscaras novas (isso é o wizard normal de importação). Sem chamada
 * de LLM.
 *
 * `semArquivos` só lista máscaras com `prefixos` EXPLICITAMENTE configurados
 * (sinal de que o médico esperava aprendizado ali) e mesmo assim sem nenhum
 * laudo — uma máscara-base qualquer com `prefixos: []` e zero dados (acervo
 * nem histórico) é simplesmente omitida, para não inflar a lista de "ficam de
 * fora" com toda máscara nunca usada da biblioteca.
 */
export function montarAlvosReaprender(config: Config, capHistorico = 40): ResumoReaprender {
  let masks: ReturnType<typeof loadLibrary> = [];
  try {
    masks = loadLibrary(bibliotecasDe(config));
  } catch {
    masks = [];
  }
  const historico = corpusDoHistorico(config.outputDir, capHistorico);
  const historicoPorMask = new Map<string, string[]>();
  for (const h of historico) {
    const lista = historicoPorMask.get(h.maskId) ?? [];
    lista.push(h.arquivo);
    historicoPorMask.set(h.maskId, lista);
  }

  const CAP_POR_MASCARA = 60; // mesmo cap do `laudo aprender todos` da CLI (corpus.ts)
  const alvos: AlvoAprendizado[] = [];
  const semArquivos: ResumoReaprender['semArquivos'] = [];
  let temHistorico = false;
  for (const m of masks) {
    const prefixosParaCasar = [...new Set([m.id, ...m.prefixos])];
    const doAcervo = existsSync(config.acervoDir)
      ? corpusPorPrefixos(config.acervoDir, prefixosParaCasar, CAP_POR_MASCARA, { contendo: m.corpus_contendo, sem: m.corpus_sem })
      : [];
    const doHistorico = historicoPorMask.get(m.id) ?? [];
    if (doAcervo.length === 0 && doHistorico.length === 0) {
      if (m.prefixos.length > 0) semArquivos.push({ maskId: m.id, nome: m.nome });
      continue;
    }
    if (doHistorico.length > 0) temHistorico = true;
    // Cap final pelo MESMO `corpusPorArquivos` do resto do pipeline (`.slice(-cap)`):
    // com histórico no fim, a edição do médico só cede espaço ao acervo quando o
    // total ultrapassa o cap — peso de recência de fato, não só na ordem.
    const arquivos = corpusPorArquivos([...doAcervo, ...doHistorico], CAP_POR_MASCARA);
    alvos.push({ tipo: 'aprender', chave: m.id, maskId: m.id, arquivos });
    // Toda máscara com corpus também ganha um alvo de SÍNTESE da conclusão (pares
    // corpo → conclusão, `destilarSintese`) — mesmo corpus, chave própria para o
    // progresso do wizard não colidir com o alvo 'aprender' da mesma máscara.
    alvos.push({ tipo: 'sintetizar', chave: `sintese:${m.id}`, maskId: m.id, arquivos });
  }
  const amostras = amostraAleatoria(
    // Só os alvos 'aprender' — os 'sintetizar' apontam para os MESMOS arquivos e
    // duplicariam candidatos na amostragem sem acrescentar corpus novo.
    alvos.filter((a) => a.tipo === 'aprender').flatMap((a) => a.arquivos),
    3,
  ).map((arquivo) => ({ arquivo: basename(arquivo), texto: corpoDoArquivo(arquivo) }));
  return { alvos, semArquivos, temHistorico, amostras };
}
