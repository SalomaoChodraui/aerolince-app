/**
 * Formatação de SAÍDA do laudo — camada aplicada DEPOIS de `stripMarkers`, na
 * hora de exibir/copiar/salvar. O `reportRaw` interno (com marcadores) NUNCA
 * passa por aqui: o motor de patches, o refino e o desfazer continuam operando
 * sobre o texto íntegro; esta camada só muda o que o médico VÊ.
 *
 * Garantias:
 * - Com as preferências padrão ('por-bloco', tudo ativo, rótulos padrão) a
 *   saída é BYTE-IDÊNTICA à entrada — quem não optou não vê mudança alguma.
 * - Nenhum texto ditado é descartado por falha de parse: rótulo desconhecido
 *   permanece como conteúdo da seção corrente; texto sem rótulos sai intacto;
 *   qualquer exceção interna devolve o texto de entrada.
 * - Seção com `ativa: false` é OMITIDA da saída (o conteúdo segue íntegro no
 *   reportRaw e no sidecar — só não aparece no texto entregue).
 */

export type ParagrafoLaudo = 'por-bloco' | 'corrido';

export interface SecaoLaudo {
  id: string;
  rotulo: string;
  ativa: boolean;
}

export interface SecaoLaudoParcial {
  id: string;
  rotulo?: string;
  ativa?: boolean;
}

export interface ExameLaudoOverride {
  paragrafo?: ParagrafoLaudo;
  secoes?: SecaoLaudoParcial[];
}

/** Bloco `laudo` da configuração (espelhado em core/config/schema.ts). */
export interface LaudoConfig {
  paragrafo: ParagrafoLaudo;
  secoes: SecaoLaudo[];
  porExame: Record<string, ExameLaudoOverride | undefined>;
}

/** Preferências já resolvidas para UM exame (global mesclada com porExame). */
export interface PrefsLaudo {
  paragrafo: ParagrafoLaudo;
  secoes: SecaoLaudo[];
}

/**
 * Seções padrão, na ordem do laudo. Os defaults PRESERVAM o comportamento
 * atual: rótulos idênticos aos das máscaras e Indicação/Observação desligadas.
 */
export const SECOES_PADRAO: readonly SecaoLaudo[] = [
  { id: 'titulo', rotulo: '', ativa: true },
  { id: 'tecnica', rotulo: 'Técnica:', ativa: true },
  { id: 'indicacao', rotulo: 'Indicação:', ativa: false },
  { id: 'achados', rotulo: 'Análise:', ativa: true },
  { id: 'achados-adicionais', rotulo: 'Achados adicionais:', ativa: true },
  { id: 'conclusao', rotulo: 'Conclusão:', ativa: true },
  { id: 'observacao', rotulo: 'Observação:', ativa: false },
];

const ROTULO_PADRAO_POR_ID = new Map(SECOES_PADRAO.map((s) => [s.id, s.rotulo]));

/** Resolve as preferências de UM exame: global mesclada com `porExame[maskId]`. */
export function prefsDoExame(config: { laudo: LaudoConfig }, maskId: string): PrefsLaudo {
  const global = config.laudo;
  const exame = global.porExame[maskId];
  const overrides = new Map((exame?.secoes ?? []).map((s) => [s.id, s]));
  return {
    paragrafo: exame?.paragrafo ?? global.paragrafo,
    secoes: global.secoes.map((s) => {
      const o = overrides.get(s.id);
      return o ? { id: s.id, rotulo: o.rotulo ?? s.rotulo, ativa: o.ativa ?? s.ativa } : s;
    }),
  };
}

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = (s: string): string => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Rótulos de seção conhecidos (case/acento-insensíveis) → id canônico da seção. */
const MAPA_ROTULOS = new Map<string, string>([
  ['tecnica', 'tecnica'],
  ['indicacao', 'indicacao'],
  ['analise', 'achados'],
  ['achados', 'achados'],
  ['descricao', 'achados'],
  ['achados adicionais', 'achados-adicionais'],
  ['conclusao', 'conclusao'],
  ['opiniao', 'conclusao'],
  ['observacao', 'observacao'],
  ['nota', 'observacao'],
]);

/**
 * Detecta um rótulo de seção conhecido no início da linha: "Técnica:", com
 * tolerância a cabeçalho markdown ("## Técnica"). Devolve também o resto da
 * linha após o ":" (conteúdo na mesma linha, raro mas possível em texto de LLM).
 */
function detectarRotulo(linha: string): { id: string; resto: string } | null {
  const m = /^\s*#{0,6}\s*([^:]{1,40}?)\s*:(.*)$/.exec(linha);
  if (m) {
    const id = MAPA_ROTULOS.get(normalizar(m[1]!));
    if (id) return { id, resto: m[2]! };
  }
  const h = /^\s*#{1,6}\s+(.{1,40}?)\s*$/.exec(linha);
  if (h) {
    const id = MAPA_ROTULOS.get(normalizar(h[1]!));
    if (id) return { id, resto: '' };
  }
  return null;
}

/** Segmento do texto: o título/preâmbulo ou uma seção rotulada, com linhas verbatim. */
interface Segmento {
  id: string;
  /** Linha original completa do rótulo (null no segmento do título/preâmbulo). */
  rotuloLinha: string | null;
  /** Conteúdo após o ":" na própria linha do rótulo ('' quando não há). */
  rotuloResto: string;
  /** Linhas após o rótulo, verbatim (incluindo linhas em branco separadoras). */
  corpo: string[];
}

function parseSegmentos(texto: string): Segmento[] {
  const segmentos: Segmento[] = [];
  let atual: Segmento = { id: 'titulo', rotuloLinha: null, rotuloResto: '', corpo: [] };
  for (const linha of texto.split('\n')) {
    const rot = detectarRotulo(linha);
    if (rot) {
      segmentos.push(atual);
      atual = { id: rot.id, rotuloLinha: linha, rotuloResto: rot.resto, corpo: [] };
    } else {
      // Linha comum (inclusive rótulo desconhecido): fica na seção corrente — nunca descartar
      atual.corpo.push(linha);
    }
  }
  segmentos.push(atual);
  return segmentos;
}

/**
 * Formata o laudo (já sem marcadores) conforme as preferências do médico.
 * Função PURA e à prova de falha: qualquer situação inesperada devolve o
 * texto de entrada intacto — nada que o médico ditou pode sumir por engano.
 */
export function formatarLaudo(texto: string, prefs: PrefsLaudo): string {
  try {
    return formatar(texto, prefs);
  } catch {
    return texto;
  }
}

/** Preferências DE FÁBRICA (ninguém mexeu): a formatação é passthrough puro. */
function saoPadrao(prefs: PrefsLaudo): boolean {
  if (prefs.paragrafo !== 'por-bloco' || prefs.secoes.length !== SECOES_PADRAO.length) return false;
  return prefs.secoes.every((s, i) => {
    const p = SECOES_PADRAO[i]!;
    return s.id === p.id && s.rotulo === p.rotulo && s.ativa === p.ativa;
  });
}

function formatar(texto: string, prefs: PrefsLaudo): string {
  if (!texto.trim()) return texto;
  // Proteção de quem não optou: com as preferências de fábrica NADA muda —
  // nem um "Nota:"/"Indicação:" pré-existente no texto é omitido pelas seções
  // que nascem desligadas (indicacao/observacao). A omissão de seção inativa
  // só vale depois que o médico mexeu nas preferências do laudo.
  if (saoPadrao(prefs)) return texto;
  const segmentos = parseSegmentos(texto);
  if (segmentos.length === 1) return texto; // nenhum rótulo conhecido: sai intacto

  const prefPorId = new Map(prefs.secoes.map((s) => [s.id, s]));
  const ativa = (seg: Segmento): boolean => prefPorId.get(seg.id)?.ativa ?? true;
  /** Novo rótulo APENAS quando o médico o customizou (≠ do padrão) — assim o
   *  default global nunca troca "Opinião:" do crânio por "Conclusão:". */
  const rotuloCustomizado = (seg: Segmento): string | null => {
    const pref = prefPorId.get(seg.id);
    const padrao = ROTULO_PADRAO_POR_ID.get(seg.id);
    if (!pref || padrao === undefined || pref.rotulo === padrao) return null;
    return pref.rotulo;
  };

  // Caminho rápido de invariância: nada a mudar → devolve a ENTRADA byte-idêntica
  const nadaMuda =
    prefs.paragrafo === 'por-bloco' && segmentos.every((s) => ativa(s) && rotuloCustomizado(s) === null);
  if (nadaMuda) return texto;

  const partes: string[] = [];
  for (const seg of segmentos) {
    if (!ativa(seg)) continue; // omitida da SAÍDA (o reportRaw segue íntegro)
    const temConteudo = seg.rotuloResto.trim() !== '' || seg.corpo.some((l) => l.trim() !== '');
    if (seg.rotuloLinha !== null && !temConteudo) continue; // seção vazia: sem rótulo órfão
    const novoRotulo = rotuloCustomizado(seg);
    const linhaRotulo =
      seg.rotuloLinha === null ? null : novoRotulo !== null ? novoRotulo + seg.rotuloResto : seg.rotuloLinha;

    if (prefs.paragrafo === 'corrido') {
      // Dentro da seção: quebra de linha simples (some a linha em branco entre blocos)
      const linhas = seg.corpo.filter((l) => l.trim() !== '');
      if (linhaRotulo !== null) linhas.unshift(linhaRotulo);
      if (linhas.length > 0) partes.push(linhas.join('\n'));
    } else {
      // por-bloco: preserva as linhas originais verbatim (só rótulo/omissões mudam)
      const linhas = [...seg.corpo];
      if (linhaRotulo !== null) linhas.unshift(linhaRotulo);
      partes.push(linhas.join('\n'));
    }
  }
  const saida = (prefs.paragrafo === 'corrido' ? partes.join('\n\n') : partes.join('\n'))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
  return saida === '' ? texto : saida;
}
