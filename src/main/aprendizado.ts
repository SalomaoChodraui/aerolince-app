/**
 * Orquestração do aprendizado (Bloco 3, T5): estimativa de custo (SEM LLM) e
 * execução (COM LLM, gate BYOK, sequencial, cancelável) de `destilar`/`aprender`;
 * mais "Meu estilo" — leitura/gravação dos itens da biblioteca do médico
 * (máscaras/regras/frasário), que é o mesmo diretório que os rascunhos gerados
 * aqui acabam promovendo (`aplicarRascunho`, em core/aprendizado/aplicar.ts).
 *
 * Progresso via `onProgresso` — o chamador (main/index.ts) repassa a TODAS as
 * janelas vivas via `webContents.send` (mesmo padrão do canal `estado`).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { writeFileAtomicSync } from '../core/atomic-write.js';
import { validarNomeRascunho } from '../core/aprendizado/aplicar.js';
import { aprenderRegras } from '../core/aprendizado/aprender.js';
import { corpusPorArquivos, montarCorpus } from '../core/aprendizado/corpus.js';
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
 */
export async function rodarAprendizado(
  alvos: AlvoAprendizado[],
  config: Config,
  onProgresso?: (p: { chave: string; etapa: string; atual: number; total: number }) => void,
): Promise<ResultadoAprendizadoLote> {
  if (emExecucao) throw new Error('já existe um aprendizado em andamento — aguarde terminar ou cancele antes de iniciar outro');
  exigirChaves(config); // gate ANTES de qualquer LLM (inclusive antes de criarLLM)
  const { llm, modelos } = criarLLM(config);

  emExecucao = true;
  canceladoFlag = false;
  const ok: ResultadoAprendizadoLote['ok'] = [];
  const falhas: ResultadoAprendizadoLote['falhas'] = [];
  try {
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
  } finally {
    emExecucao = false;
  }
  return { ok, falhas };
}

// ── Meu estilo (leitura/gravação da biblioteca do médico) ───────────────────

export interface ItemEstiloMascara {
  id: string;
  nome: string;
  origemEfetiva: 'base' | 'minha';
}

export interface ResumoEstilo {
  mascaras: ItemEstiloMascara[];
  regras: string[];
  frasario: string[];
}

/** Nomes (sem `.md`) dos arquivos de um diretório; `[]` se ausente. */
function nomesSemExtensao(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

/** Catálogo do "Meu estilo": máscaras efetivas (com origem) + nomes de regras/frasário disponíveis para editar. */
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
  const regras = [
    ...new Set([...nomesSemExtensao(join(config.bibliotecaBaseDir, 'regras')), ...nomesSemExtensao(join(config.masksDir, 'regras'))]),
  ].sort();
  const frasario = [
    ...new Set([...nomesSemExtensao(join(config.bibliotecaBaseDir, 'frasario')), ...nomesSemExtensao(join(config.masksDir, 'frasario'))]),
  ].sort();
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
