/**
 * Sanitização de documentos do acervo para persistência local: aplica `sanitize()`
 * do anonymizer (reforçado pelo nome de paciente extraído do NOME DO ARQUIVO
 * original, quando este seguir o padrão da clínica) e grava o resultado com
 * frontmatter de PROVENIÊNCIA — exame/modalidade/contraste/origem_hash/confiança.
 *
 * O nome do arquivo gravado NUNCA contém nome de paciente: usa a chave do
 * cluster (`sugerirMaskId`) + data (só se vier do nome original no padrão da
 * clínica; senão `s-d` — nunca a data de hoje, que vira dado derivável) + índice.
 *
 * Função pura no sentido de não conhecer nada de Electron; faz IO local (grava
 * em `acervoDir`, escrita atômica) e nenhuma chamada de rede.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { patientNameFromFilename, sanitize } from '../anonymizer/anonymizer.js';
import { writeFileAtomicSync } from '../atomic-write.js';
import { agruparClusters, sugerirMaskId, type Classificacao } from './classificar.js';

export interface SanitizarParaAcervoParams {
  texto: string;
  nomeOriginal: string;
  classif: Classificacao;
  acervoDir: string;
  indice: number;
}

export interface SanitizarParaAcervoResultado {
  /** Caminho absoluto do arquivo gravado (sem nome de paciente). */
  arquivo: string;
  findings: number;
  suspeito: boolean;
}

/** "AAAA-MM-DD_" no início do nome — o único padrão de data da clínica (ver scripts/sanitize-pdfs.ts). */
const DATA_NO_NOME = /^(\d{4}-\d{2}-\d{2})_/;

/** Data do nome original se seguir o padrão da clínica; senão 's-d' (sem data) — NUNCA a data de hoje. */
function dataDoNomeOriginal(nomeOriginal: string): string {
  return DATA_NO_NOME.exec(nomeOriginal)?.[1] ?? 's-d';
}

/**
 * Chave do cluster ao qual este documento pertenceria sozinho — mesma fórmula
 * de `agruparClusters`/`sugerirMaskId` (T2), sem duplicá-la aqui.
 */
function chaveClusterDe(classif: Classificacao, arquivo: string): string {
  const [cluster] = agruparClusters([{ arquivo, c: classif }]);
  return sugerirMaskId(cluster!);
}

/**
 * Confiança da classificação do documento: 'alta' quando modalidade E exame
 * foram reconhecidos por conteúdo; 'baixa' quando qualquer um ficou indefinido
 * (título irreconhecível) — sinaliza ao médico quais entradas do acervo merecem
 * revisão manual antes de entrarem num cluster de aprendizado.
 */
function confiancaDe(classif: Classificacao): 'alta' | 'baixa' {
  return classif.modalidade !== 'desconhecida' && classif.exame !== null ? 'alta' : 'baixa';
}

/**
 * sha256 do texto ORIGINAL (pré-sanitização), truncado a 12 hex — estável, não
 * reversível. Exportada (não só usada aqui) porque `main/acervo.ts` precisa da
 * MESMA função para reconhecer, ao reimportar, um texto já gravado no acervo
 * (`origem_hash` do frontmatter) — nunca duplicar a fórmula do hash em dois
 * lugares, ou os dois seriam capazes de divergir silenciosamente.
 */
export function origemHash(textoOriginal: string): string {
  return createHash('sha256').update(textoOriginal, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Sanitiza um documento do acervo e grava com frontmatter de proveniência.
 * `suspeito` (heurística atual do sanitize-pdfs): o nome do arquivo indicava
 * paciente, mas zero ocorrências tipo 'nome' foram mascaradas no corpo — sinal
 * de que o nome do arquivo e o conteúdo podem não bater (revisar manualmente).
 */
export function sanitizarParaAcervo(params: SanitizarParaAcervoParams): SanitizarParaAcervoResultado {
  const { texto, nomeOriginal, classif, acervoDir, indice } = params;

  const nomePaciente = patientNameFromFilename(nomeOriginal);
  const { clean, findings } = sanitize(texto, { extraNames: nomePaciente ? [nomePaciente] : [] });
  const nomesMascarados = findings.filter((f) => f.tipo === 'nome').length;
  const suspeito = nomePaciente !== null && nomesMascarados === 0;

  const chaveCluster = chaveClusterDe(classif, nomeOriginal);
  const data = dataDoNomeOriginal(nomeOriginal);
  const nnn = String(indice).padStart(3, '0');
  const arquivo = join(acervoDir, `${chaveCluster}_${data}_${nnn}.md`);

  const frontmatter = {
    exame: chaveCluster,
    modalidade: classif.modalidade,
    contraste: classif.contraste,
    origem_hash: origemHash(texto),
    confianca: confiancaDe(classif),
  };
  const conteudo = matter.stringify(clean, frontmatter);

  mkdirSync(acervoDir, { recursive: true });
  writeFileAtomicSync(arquivo, conteudo);

  return { arquivo, findings: findings.length, suspeito };
}

/**
 * Corpo de um documento do acervo, tolerando arquivos legados (`tmp-sanitized`)
 * sem frontmatter: com frontmatter → `content` (sem o YAML); sem → arquivo
 * inteiro. Usado pelo leitor de corpus (T4) para não depender do formato.
 */
export function corpoDoArquivo(caminho: string): string {
  const bruto = readFileSync(caminho, 'utf8');
  if (!matter.test(bruto)) return bruto;
  return matter(bruto).content;
}
