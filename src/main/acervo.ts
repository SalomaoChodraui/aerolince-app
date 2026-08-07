/**
 * Orquestração do acervo (Bloco 3, T5): escolha de arquivos (diálogo nativo) e
 * importação — extrai + classifica + sanitiza, 100% local (NENHUMA chamada de
 * LLM/rede aqui). `importarAcervo` reporta progresso por evento (o chamador em
 * `index.ts` repassa a TODAS as janelas vivas, mesmo padrão do canal `estado`).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { dialog } from 'electron';
import { agruparClusters, classificarDocumento, sugerirMaskId, type Classificacao } from '../core/acervo/classificar.js';
import { extrairTexto } from '../core/acervo/extrair.js';
import { corpoDoArquivo, sanitizarParaAcervo } from '../core/acervo/sanitizar.js';
import type { Config } from '../core/config/schema.js';
import { bibliotecasDe, loadLibrary } from '../core/masks/library.js';

const EXTENSOES_ACEITAS = new Set(['.pdf', '.docx', '.txt']);

export interface ProgressoAcervo {
  fase: 'extraindo' | 'classificando' | 'sanitizando';
  atual: number;
  total: number;
  arquivo?: string;
}

export interface ClusterImportacao {
  chave: string;
  exame: string | null;
  modalidade: string;
  contraste: 'com' | 'sem';
  quantidade: number;
  /** Id de máscara já existente na biblioteca (base+médico) que casa com este cluster; null se nenhuma. */
  maskIdExistente: string | null;
  /** Caminhos ABSOLUTOS dos arquivos sanitizados deste cluster em `config.acervoDir` — é o que o wizard usa para montar `AlvoAprendizado.arquivos` (nunca os originais). */
  arquivos: string[];
}

export interface ResumoImportacao {
  clusters: ClusterImportacao[];
  /** Nomes dos arquivos sem texto útil extraído (imagem, formato não suportado, erro de leitura). */
  semTexto: string[];
  naoReconhecidos: number;
  /** Até 3 amostras sanitizadas escolhidas ao acaso — texto já pronto p/ exibição (sem paciente). */
  amostras: { arquivo: string; texto: string }[];
  suspeitos: number;
}

/**
 * Expande cada entrada que for uma PASTA para os arquivos aceitos (pdf/docx/txt)
 * diretamente dentro dela — 1 nível, sem recursão em subpastas; caminhos que já
 * são arquivo passam direto, SEM checar extensão aqui (quem decide o que fazer
 * com formato não suportado é `extrairTexto`, que conta e reporta em `semTexto`
 * em vez de descartar em silêncio). Caminhos inexistentes são ignorados.
 *
 * Usada tanto pelo diálogo nativo (`escolherArquivosAcervo`, que filtra o
 * próprio diálogo por extensão) quanto por `importarAcervo` — este último
 * também recebe os caminhos soltos por ARRASTE no wizard, que podem incluir
 * uma pasta inteira (o filtro do `onDrop` no renderer só descarta o óbvio,
 * extensão claramente errada; não sabe distinguir pasta de arquivo sem tocar
 * o disco — essa distinção só é possível aqui, no processo principal).
 */
function expandirPastas(paths: string[]): string[] {
  const arquivos: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) {
        const caminho = join(p, f);
        if (EXTENSOES_ACEITAS.has(extname(f).toLowerCase()) && statSync(caminho).isFile()) arquivos.push(caminho);
      }
    } else {
      arquivos.push(p);
    }
  }
  return arquivos;
}

/**
 * Abre o diálogo nativo para escolher arquivos OU uma pasta (openFile +
 * multiSelections + openDirectory), filtrando pdf/docx/txt. Uma pasta
 * escolhida expande 1 nível (só os arquivos diretamente dentro dela — sem
 * recursão em subpastas). `null` quando o médico cancela ou nada é encontrado.
 */
export async function escolherArquivosAcervo(): Promise<string[] | null> {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections', 'openDirectory'],
    filters: [{ name: 'Laudos (PDF, Word, texto)', extensions: ['pdf', 'docx', 'txt'] }],
  });
  if (r.canceled || r.filePaths.length === 0) return null;

  const arquivos = expandirPastas(r.filePaths).filter((p) => EXTENSOES_ACEITAS.has(extname(p).toLowerCase()));
  return arquivos.length > 0 ? arquivos : null;
}

/** Ids de máscara já existentes nas duas camadas (base + médico); nunca lança — biblioteca vazia vira conjunto vazio. */
function idsDeMascarasExistentes(config: Config): Set<string> {
  try {
    return new Set(loadLibrary(bibliotecasDe(config)).map((m) => m.id));
  } catch {
    return new Set();
  }
}

/** Nome de arquivo já gravado pelo acervo: `<chave>_<data|s-d>_<nnn>.md` (ver `sanitizar.ts`). */
const NOME_ARQUIVO_ACERVO = /^(.+)_(?:\d{4}-\d{2}-\d{2}|s-d)_(\d{3})\.md$/;

/**
 * MAIOR índice `nnn` já gravado por chave de cluster em `acervoDir` — para a numeração
 * continuar entre importações sem nunca colidir com uma entrada antiga (M2). Antes usava a
 * CONTAGEM de arquivos, não o máximo: se um arquivo do meio da sequência fosse apagado
 * (ex.: `001` e `003` existentes, `002` removido), a contagem (2) fazia o próximo índice
 * calculado pelo chamador (`contagem + 1` = 3) COLIDIR e sobrescrever o `003` já existente.
 * Exportada só para teste direto.
 */
export function contadoresExistentes(acervoDir: string): Map<string, number> {
  const maiorIndice = new Map<string, number>();
  if (!existsSync(acervoDir)) return maiorIndice;
  for (const f of readdirSync(acervoDir)) {
    const m = NOME_ARQUIVO_ACERVO.exec(f);
    if (!m) continue;
    const chave = m[1]!;
    const indice = Number(m[2]);
    maiorIndice.set(chave, Math.max(maiorIndice.get(chave) ?? 0, indice));
  }
  return maiorIndice;
}

/** Escolhe até `n` itens ao acaso, sem repetição. Reusada por `montarAlvosReaprender` (I3) para as
 *  amostras do consentimento do "Reaprender" — mesmo critério das amostras da importação normal. */
export function amostraAleatoria<T>(itens: T[], n: number): T[] {
  const copia = [...itens];
  const escolhidos: T[] = [];
  while (copia.length > 0 && escolhidos.length < n) {
    const i = Math.floor(Math.random() * copia.length);
    escolhidos.push(copia.splice(i, 1)[0]!);
  }
  return escolhidos;
}

/**
 * Importa os arquivos escolhidos para `config.acervoDir`: extrai texto →
 * classifica → sanitiza, TUDO local (sem rede, sem LLM). `onProgresso` dispara
 * uma vez por arquivo em cada uma das 3 fases — o chamador (main/index.ts)
 * repassa para todas as janelas vivas via `webContents.send`.
 *
 * `maskIdExistente` de cada cluster casa `sugerirMaskId(cluster)` (= a própria
 * chave) com os ids já carregados pela biblioteca (base+médico) — é o sinal
 * que o wizard usa para oferecer "aprender" (máscara já existe) vs "destilar"
 * (máscara nova).
 *
 * `paths` pode incluir PASTAS inteiras (o wizard aceita arraste de pasta,
 * além do diálogo nativo) — `expandirPastas` resolve isso antes de qualquer
 * outra coisa, mesma regra de 1 nível sem recursão do diálogo.
 */
export async function importarAcervo(
  paths: string[],
  config: Config,
  onProgresso?: (p: ProgressoAcervo) => void,
): Promise<ResumoImportacao> {
  const arquivosEntrada = expandirPastas(paths);

  // Fase 1 — extração de texto (IO; um arquivo por vez, ordem previsível).
  const extraidos: { caminho: string; texto: string }[] = [];
  const semTexto: string[] = [];
  for (let i = 0; i < arquivosEntrada.length; i++) {
    const caminho = arquivosEntrada[i]!;
    onProgresso?.({ fase: 'extraindo', atual: i + 1, total: arquivosEntrada.length, arquivo: basename(caminho) });
    const r = await extrairTexto(caminho);
    if (r.ok) extraidos.push({ caminho, texto: r.texto });
    else semTexto.push(basename(caminho)); // 'sem-texto' | 'formato' | 'erro' — todos entram aqui: nenhum vira acervo
  }

  // Fase 2 — classificação (pura, sem IO extra).
  const classificados: { caminho: string; texto: string; classif: Classificacao }[] = [];
  for (let i = 0; i < extraidos.length; i++) {
    const { caminho, texto } = extraidos[i]!;
    onProgresso?.({ fase: 'classificando', atual: i + 1, total: extraidos.length, arquivo: basename(caminho) });
    classificados.push({ caminho, texto, classif: classificarDocumento(texto) });
  }

  const naoReconhecidos = classificados.filter((c) => c.classif.exame === null).length;
  const clustersBrutos = agruparClusters(classificados.map((c) => ({ arquivo: c.caminho, c: c.classif })));
  const idsExistentes = idsDeMascarasExistentes(config);
  const chavePorCaminho = new Map<string, string>();
  for (const c of clustersBrutos) for (const arquivo of c.arquivos) chavePorCaminho.set(arquivo, c.chave);

  // Fase 3 — sanitização + gravação em `config.acervoDir` (nome de arquivo sem paciente).
  // `gravadosPorChave` reagrupa os arquivos GRAVADOS (acervoDir) por cluster — é o que o
  // wizard (T6) precisa para montar `AlvoAprendizado.arquivos` (o corpus do aprendizado lê
  // do acervo sanitizado, nunca dos originais em `paths`).
  const contadores = contadoresExistentes(config.acervoDir);
  let suspeitos = 0;
  const gravados: string[] = [];
  const gravadosPorChave = new Map<string, string[]>();
  for (let i = 0; i < classificados.length; i++) {
    const { caminho, texto, classif } = classificados[i]!;
    onProgresso?.({ fase: 'sanitizando', atual: i + 1, total: classificados.length, arquivo: basename(caminho) });
    const chave = chavePorCaminho.get(caminho)!;
    const indice = (contadores.get(chave) ?? 0) + 1;
    contadores.set(chave, indice);
    const r = sanitizarParaAcervo({
      texto,
      nomeOriginal: basename(caminho),
      classif,
      acervoDir: config.acervoDir,
      indice,
    });
    if (r.suspeito) suspeitos++;
    gravados.push(r.arquivo);
    const lista = gravadosPorChave.get(chave) ?? [];
    lista.push(r.arquivo);
    gravadosPorChave.set(chave, lista);
  }

  const clusters: ClusterImportacao[] = clustersBrutos.map((c) => ({
    chave: c.chave,
    exame: c.exame,
    modalidade: c.modalidade,
    contraste: c.contraste,
    quantidade: c.arquivos.length,
    maskIdExistente: idsExistentes.has(sugerirMaskId(c)) ? sugerirMaskId(c) : null,
    arquivos: gravadosPorChave.get(c.chave) ?? [],
  }));

  const amostras = amostraAleatoria(gravados, 3).map((arquivo) => ({
    arquivo: basename(arquivo),
    texto: corpoDoArquivo(arquivo),
  }));

  return { clusters, semTexto, naoReconhecidos, amostras, suspeitos };
}
