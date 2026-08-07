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
import { basename, dirname, join } from 'node:path';
import matter from 'gray-matter';
import { sanitize } from '../core/anonymizer/anonymizer.js';
import { writeFileAtomicSync } from '../core/atomic-write.js';
import { validarNomeRascunho } from '../core/aprendizado/aplicar.js';
import { aprenderRegras } from '../core/aprendizado/aprender.js';
import { corpusPorArquivos, corpusPorPrefixos, montarCorpus } from '../core/aprendizado/corpus.js';
import { estimarCustoAprendizado } from '../core/aprendizado/custo.js';
import { destilarMascara } from '../core/aprendizado/destilar.js';
import type { Config } from '../core/config/schema.js';
import { criarLLM } from '../core/llm/factory.js';
import { bibliotecasDe, loadLibrary } from '../core/masks/library.js';
import { MaskFrontmatterSchema } from '../core/masks/schema.js';
import { exigirChaves } from './pipeline.js';

export interface AlvoAprendizado {
  tipo: 'destilar' | 'aprender';
  /** Chave do cluster do acervo (identifica o alvo para o wizard/progresso — não é usada em caminho de arquivo). */
  chave: string;
  /** Id da máscara: existente (aprender) ou nova (destilar). */
  maskId: string;
  arquivos: string[];
}

// Espelha o `maxTokens` usado internamente por destilarMascara/aprenderRegras
// (core/aprendizado/{destilar,aprender}.ts) — mantenha em sincronia se mudar lá.
const MAX_TOKENS_DESTILAR = 2500;
const MAX_TOKENS_APRENDER = 4000;

function maxTokensDe(tipo: AlvoAprendizado['tipo']): number {
  return tipo === 'destilar' ? MAX_TOKENS_DESTILAR : MAX_TOKENS_APRENDER;
}

export interface EstimativaAprendizado {
  porAlvo: { chave: string; custoAproxUSD: number | null }[];
  totalUSD: number | null;
}

/**
 * Estimativa de custo ANTES de qualquer chamada de LLM — só lê os arquivos
 * localmente (via `corpusPorArquivos`/`montarCorpus`, reuso do core). NÃO exige
 * chaves configuradas: usa `config.llm.generationModel` diretamente em vez de
 * `criarLLM` (que, no provedor 'openai', lança se a chave estiver ausente —
 * comportamento indesejado numa estimativa que deve funcionar sem BYOK).
 */
export function estimarAprendizado(alvos: AlvoAprendizado[], config: Config): EstimativaAprendizado {
  const modelo = config.llm.generationModel;
  const porAlvo = alvos.map((alvo) => {
    try {
      const arquivos = corpusPorArquivos(alvo.arquivos, alvo.arquivos.length);
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
 * Higiene de privacidade: se algum `alvo.arquivos` vier de `corpusDoHistorico`
 * (Reaprender — arquivos temporários fora de `outputDir`), esses diretórios
 * são apagados no `finally`, DEPOIS que todo o lote terminou (sucesso, falha
 * OU cancelamento — o corpus já foi lido por `montarCorpus` a essa altura, não
 * precisa sobreviver). Cobre também a falha do gate `exigirChaves`: nada de
 * lixo permanente em `tmpdir()` mesmo se o BYOK não estiver configurado.
 */
export async function rodarAprendizado(
  alvos: AlvoAprendizado[],
  config: Config,
  onProgresso?: (p: { chave: string; etapa: string; atual: number; total: number }) => void,
): Promise<ResultadoAprendizadoLote> {
  if (emExecucao) throw new Error('já existe um aprendizado em andamento — aguarde terminar ou cancele antes de iniciar outro');
  const tempDirsHistorico = tempDirsDoCorpusHistorico(alvos);
  emExecucao = true;
  try {
    exigirChaves(config); // gate ANTES de qualquer LLM (inclusive antes de criarLLM)
    const { llm, modelos } = criarLLM(config);

    canceladoFlag = false;
    const ok: ResultadoAprendizadoLote['ok'] = [];
    const falhas: ResultadoAprendizadoLote['falhas'] = [];
    for (const alvo of alvos) {
      if (canceladoFlag) break; // interrompe de fato: nenhum alvo novo começa após cancelar
      const opts = {
        llm,
        modelo: modelos.geracao,
        onProgresso: (p: { etapa: string; atual: number; total: number }) => onProgresso?.({ chave: alvo.chave, ...p }),
        cancelado: () => canceladoFlag,
      };
      try {
        const r =
          alvo.tipo === 'destilar'
            ? await destilarMascara({ id: alvo.maskId, arquivos: alvo.arquivos, masksDir: config.masksDir }, opts)
            : await aprenderRegras({ maskId: alvo.maskId, arquivos: alvo.arquivos, masksDir: config.masksDir }, opts);
        ok.push({ chave: alvo.chave, arquivo: r.arquivo, custoUSD: r.custoUSD ?? 0 });
      } catch (err) {
        falhas.push({ chave: alvo.chave, erro: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ok, falhas };
  } finally {
    emExecucao = false;
    limparTempDirsDoCorpus(tempDirsHistorico);
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

export interface ResumoEstilo {
  mascaras: ItemEstiloMascara[];
  regras: ItemEstilo[];
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
  const regras = itensComOrigem(join(config.bibliotecaBaseDir, 'regras'), join(config.masksDir, 'regras'));
  const frasario = itensComOrigem(join(config.bibliotecaBaseDir, 'frasario'), join(config.masksDir, 'frasario'));
  return { mascaras, regras, frasario };
}

/** Caminho relativo (dentro de uma camada) do item — `nome` já validado pelo chamador. */
function caminhoRelativoDe(tipo: 'mascara' | 'regras' | 'frasario', nome: string): string {
  return tipo === 'mascara' ? `${nome}.md` : join(tipo, `${nome}.md`);
}

/**
 * Lê o conteúdo EFETIVO do item (médico vence a base). `nome` passa por
 * `validarNomeRascunho` — mesma barreira antitraversal usada pelos rascunhos
 * (rejeita `/`, `\`, `.`, `..`; reuso deliberado, a validação é genérica).
 */
export function lerEstilo(config: Config, tipo: 'mascara' | 'regras' | 'frasario', nome: string): string {
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
export function salvarEstilo(config: Config, tipo: 'mascara' | 'regras' | 'frasario', nome: string, texto: string): void {
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
// `limparCorpusHistoricoOrfao`). Esses diretórios não têm política de retenção própria como o
// spool de áudio (cifrado, ≤48 h) — são só texto já sanitizado, mas mesmo assim não devem
// acumular para sempre no temp do SO (higiene de privacidade).
const PREFIXO_TMP_CORPUS_HISTORICO = 'aerolince-corpus-historico-';

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

export interface ResumoReaprender {
  alvos: AlvoAprendizado[];
  /** Máscaras com `prefixos` configurados mas sem nenhum laudo disponível ainda (nem acervo, nem histórico editado). */
  semArquivos: { maskId: string; nome: string }[];
}

/**
 * Monta os alvos do botão "Reaprender com meus laudos" (janela Meu Estilo):
 * para cada máscara com `prefixos` configurados, junta os laudos já
 * sanitizados no ACERVO (`corpusPorPrefixos`, mesmo mecanismo do `laudo
 * aprender todos` da CLI) com os do HISTÓRICO EDITADO (`corpusDoHistorico`)
 * que pertencem à mesma máscara. O histórico entra no FIM da lista — como o
 * cap de `corpusPorArquivos` corta pelo INÍCIO (`slice(-cap)`), a edição do
 * médico tem prioridade sobre o acervo mais antigo quando o total excede o
 * cap (peso de recência). Só gera alvos `'aprender'` (fraseado de máscaras
 * já existentes) — "Reaprender" refina o estilo, não descobre máscaras novas
 * (isso é o wizard normal de importação). Sem chamada de LLM.
 */
export function montarAlvosReaprender(config: Config, capHistorico = 40): ResumoReaprender {
  let masks: ReturnType<typeof loadLibrary> = [];
  try {
    masks = loadLibrary(bibliotecasDe(config));
  } catch {
    masks = [];
  }
  const comPrefixos = masks.filter((m) => m.prefixos.length > 0);
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
  for (const m of comPrefixos) {
    const doAcervo = existsSync(config.acervoDir)
      ? corpusPorPrefixos(config.acervoDir, m.prefixos, CAP_POR_MASCARA, { contendo: m.corpus_contendo, sem: m.corpus_sem })
      : [];
    const doHistorico = historicoPorMask.get(m.id) ?? [];
    if (doAcervo.length === 0 && doHistorico.length === 0) {
      semArquivos.push({ maskId: m.id, nome: m.nome });
      continue;
    }
    // Cap final pelo MESMO `corpusPorArquivos` do resto do pipeline (`.slice(-cap)`):
    // com histórico no fim, a edição do médico só cede espaço ao acervo quando o
    // total ultrapassa o cap — peso de recência de fato, não só na ordem.
    const arquivos = corpusPorArquivos([...doAcervo, ...doHistorico], CAP_POR_MASCARA);
    alvos.push({ tipo: 'aprender', chave: m.id, maskId: m.id, arquivos });
  }
  return { alvos, semArquivos };
}
