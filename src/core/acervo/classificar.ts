/**
 * Classificador determinístico de documentos do acervo, por CONTEÚDO (sem LLM,
 * sem IO, custo zero): detecta modalidade, exame (slug canônico sem lateralidade),
 * uso de contraste e lateralidade a partir do título e do corpo do laudo. Também
 * agrupa documentos equivalentes em clusters para sugerir uma máscara-consenso.
 *
 * Funções PURAS — strings entram, classificação sai. Nenhuma menção a paciente é
 * lida aqui; o módulo só olha para o texto já extraído (ver `extrair.ts`).
 */

export interface Classificacao {
  modalidade: 'tc' | 'rm' | 'us' | 'rx' | 'mg' | 'desconhecida';
  /** Slug kebab do exame, SEM lateralidade (ex.: "cranio", "abdome-total", "joelho"); null quando o título não é reconhecível. */
  exame: string | null;
  contraste: 'com' | 'sem';
  lateral: boolean;
}

export interface Cluster {
  /** `${modalidade}-${exame ?? 'nao-reconhecido'}` (+ `-com-contraste` quando aplicável). */
  chave: string;
  modalidade: string;
  exame: string | null;
  contraste: 'com' | 'sem';
  /** true se QUALQUER documento do cluster tiver lateralidade (laterais colapsam num único cluster). */
  lateral: boolean;
  arquivos: string[];
}

/** Minúsculas + sem acento (NFD, remove marcas diacríticas) — acento/case-insensível em todo o módulo. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Kebab-case a partir de texto livre (já normalizado ou não). */
function slug(s: string): string {
  return normalizar(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Padrões de modalidade testados na 1ª linha de título que casar (nessa ordem). */
const PADROES_MODALIDADE: { regex: RegExp; modalidade: Classificacao['modalidade'] }[] = [
  { regex: /tomografia computadorizada/, modalidade: 'tc' },
  { regex: /ressonancia(\s+magnetica)?/, modalidade: 'rm' },
  { regex: /ultrassonografia|ultra-sonografia|ecografia/, modalidade: 'us' },
  { regex: /radiografia|raios x|raio-x/, modalidade: 'rx' },
  { regex: /mamografia/, modalidade: 'mg' },
];

/** Conector "DA/DE/DO/DOS/DAS" que separa a modalidade do complemento (o exame). */
const CONECTOR = /\b(?:da|de|do|dos|das)\b\s*(.+)/;

/** Sufixos de lateralidade — removidos do slug e sinalizados em `lateral`. */
const LATERALIDADE = /\b(?:direit[oa]|esquerd[oa]|dir|esq|bilateral)\b/;

/**
 * Tabela de sinônimos do exame: cada entrada é testada na FRASE INTEIRA (não na
 * primeira palavra que aparece) e a tabela é percorrida NA ORDEM — mais
 * específico primeiro. Isso é o que evita a classe de bug de colisão entre uma
 * combinação de membros conhecida e um membro isolado que também aparece na
 * mesma frase: "TORNOZELO E PÉ" contém a palavra "tornozelo", mas o id real da
 * biblioteca para essa combinação é `tc-pe` (sinônimo oficial: "TC do tornozelo
 * e pé") — DIFERENTE do id `tc-tornozelo` (só tornozelo). Um `exec()` que anda
 * da esquerda para a direita erraria aqui, pois "tornozelo" aparece ANTES de
 * "pe" na frase; testar a combinação primeiro, independente de posição, resolve.
 */
const SINONIMOS_EXAME: { teste: (fraseInteira: string) => boolean; slug: string }[] = [
  // Combinações específicas de membros ANTES dos membros isolados abaixo.
  { teste: (f) => /\bpe\b/.test(f) && /\btornozelo\b/.test(f), slug: 'pe' },
  { teste: (f) => /\b(?:encefalo|cranio)\b/.test(f), slug: 'cranio' },
  { teste: (f) => /\babdome\b/.test(f), slug: 'abdome-total' },
  { teste: (f) => /\btorax\b/.test(f), slug: 'torax' },
  { teste: (f) => /\bcoluna\s+lombar\b|\blombo-?sacra\b/.test(f), slug: 'coluna-lombar' },
  { teste: (f) => /\bcoluna\s+cervical\b/.test(f), slug: 'coluna-cervical' },
  { teste: (f) => /\bcoluna\s+toracica\b/.test(f), slug: 'coluna-toracica' },
  { teste: (f) => /seios da face|seios paranasais|\bface\b/.test(f), slug: 'seios-da-face' },
  { teste: (f) => /\bsacro-?iliacas?\b/.test(f), slug: 'sacro-iliacas' },
  // Membros isolados (só chegam aqui se a combinação acima não bateu).
  { teste: (f) => /\bjoelho\b/.test(f), slug: 'joelho' },
  { teste: (f) => /\bombro\b/.test(f), slug: 'ombro' },
  { teste: (f) => /\bpunho\b/.test(f), slug: 'punho' },
  { teste: (f) => /\bcotovelo\b/.test(f), slug: 'cotovelo' },
  { teste: (f) => /\btornozelo\b/.test(f), slug: 'tornozelo' },
  { teste: (f) => /\bpe\b/.test(f), slug: 'pe' },
  { teste: (f) => /\bmao\b/.test(f), slug: 'mao' },
  { teste: (f) => /\bbacia\b/.test(f), slug: 'bacia' },
  { teste: (f) => /\bquadril\b/.test(f), slug: 'quadril' },
];

function sinonimoExame(fraseSemLateralidade: string): string | null {
  return SINONIMOS_EXAME.find((s) => s.teste(fraseSemLateralidade))?.slug ?? null;
}

/**
 * Remove marcadores de lateralidade da frase e sinaliza se havia algum.
 * Ex.: "joelho esquerdo" → { semLateral: "joelho", lateral: true }.
 */
function removerLateralidade(frase: string): { semLateral: string; lateral: boolean } {
  const lateral = LATERALIDADE.test(frase);
  const semLateral = frase
    .replace(new RegExp(LATERALIDADE.source, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { semLateral, lateral };
}

/**
 * Gatilhos positivos de contraste — frases da convenção do serviço (PT-BR formal de laudo)
 * MAIS marcadores de protocolo multifásico. "injeção intravenosa/endovenosa" e "uso
 * intravenoso/endovenoso" são os DOIS fraseados REAIS de Técnica encontrados nas 18
 * máscaras da biblioteca-base: 17 delas usam "injeção intravenosa" (ex.:
 * tc-abdome-total-com-contraste.md: "após injeção intravenosa do meio de contraste
 * iodado") e tc-cranio.md, sozinha, usa "uso intravenoso" ("sem uso intravenoso do meio
 * de contraste iodado"). "Endovenoso" é sinônimo comum de "intravenoso" em laudos reais
 * — incluído por robustez, mesmo sem ocorrência literal na base atual. "fase
 * arterial/venosa/portal/tardia/excretora" é o vocabulário de protocolo que só existe em
 * estudo contrastado (as fases são definidas pelo momento da circulação do contraste) —
 * sinaliza contraste mesmo quando o laudo não repete "com contraste" na mesma frase (caso
 * típico de estudo multifásico, onde a Técnica pode citar uma fase SEM contraste seguida
 * de fases COM). Deliberadamente NÃO incluídos: "realce"/"contrastad(o/a)" — aparecem
 * também no corpo de ACHADOS de estudos SEM contraste (ex.: "sem realce anômalo" é uma
 * afirmação normal em exames sem contraste), e o passo de neutralização abaixo não cobre
 * esse tipo de negação de achado (só neutraliza negação de PROTOCOLO/Técnica).
 */
const CONTRASTE_POSITIVO =
  /\bcom contraste\b|\badministracao intravenosa\b|\buso do meio de contraste\b|\binjecao (?:intravenosa|endovenosa)\b|\buso (?:intravenoso|endovenoso)\b|\bfases?\s+(?:arterial|venos[ao]|portal|tardia|excretora)\b/;

/**
 * Padrões de NEGAÇÃO de protocolo — cuidado: "administração/injeção/uso intravenoso"
 * sozinha é a frase AFIRMATIVA; a negativa típica é "SEM a administração/injeção
 * intravenosa"/"sem uso intravenoso"/"sem contraste"/"não foi administrado" (ex.:
 * tc-abdome-total.md: "sem injeção intravenosa do meio de contraste"; tc-cranio.md: "sem
 * uso intravenoso do meio de contraste"). Usado para NEUTRALIZAR (remover) essas
 * ocorrências do texto ANTES de testar os gatilhos positivos — ver `detectarContraste`.
 */
const NEGACAO_CONTRASTE_SRC =
  String.raw`\bsem\s+(?:a\s+|o\s+)?(?:administracao|injecao|uso)\s+(?:intravenos[ao]|endovenos[ao]|de contraste|do contraste|do meio de contraste)\b` +
  `|\\bsem contraste\\b` +
  `|\\bnao foi administrado\\b`;

/**
 * Detecta uso de contraste no texto inteiro do documento (título + corpo), por
 * NEUTRALIZAÇÃO em vez de short-circuit: (1) remove do texto TODAS as ocorrências dos
 * padrões de negação de protocolo (`NEGACAO_CONTRASTE_SRC`); (2) testa os gatilhos
 * positivos (`CONTRASTE_POSITIVO`) apenas no que sobrou. Isso corrige um bug real: um
 * short-circuit global ("se o texto INTEIRO contém qualquer negação, é 'sem'") classificava
 * errado um laudo multifásico que cita uma fase SEM contraste e, na MESMA Técnica, outra
 * fase COM contraste — o "sem" isolado bloqueava o "com" genuíno mais adiante no texto.
 * NÃO é uma análise de escopo de negação real (não entende "a menos que", parênteses,
 * etc.) — é uma heurística determinística sobre o vocabulário de protocolo conhecido desta
 * base; ver o comentário de `CONTRASTE_POSITIVO` sobre o que foi deliberadamente deixado
 * de fora.
 */
function detectarContraste(texto: string): 'com' | 'sem' {
  const t = normalizar(texto);
  const semNegacoesDeProtocolo = t.replace(new RegExp(NEGACAO_CONTRASTE_SRC, 'g'), ' ');
  return CONTRASTE_POSITIVO.test(semNegacoesDeProtocolo) ? 'com' : 'sem';
}

/** Acha a 1ª linha de título que bate com alguma modalidade e extrai o complemento (exame cru). */
function acharTituloEComplemento(texto: string): { modalidade: Classificacao['modalidade']; complemento: string | null } {
  for (const linhaOriginal of texto.split(/\r?\n/)) {
    const linha = normalizar(linhaOriginal);
    for (const padrao of PADROES_MODALIDADE) {
      const match = padrao.regex.exec(linha);
      if (!match) continue;
      const largura = match[0]?.length ?? 0;
      const resto = linha.slice(match.index + largura);
      const conector = CONECTOR.exec(resto);
      const complemento = conector?.[1]?.trim() || null;
      return { modalidade: padrao.modalidade, complemento };
    }
  }
  return { modalidade: 'desconhecida', complemento: null };
}

/** Classifica um documento do acervo pelo conteúdo textual (100% local, determinístico). */
export function classificarDocumento(texto: string): Classificacao {
  const { modalidade, complemento } = acharTituloEComplemento(texto);

  let exame: string | null = null;
  let lateral = false;
  if (complemento) {
    const { semLateral, lateral: achouLateral } = removerLateralidade(complemento);
    lateral = achouLateral;
    exame = sinonimoExame(semLateral) ?? (slug(semLateral) || null);
  }

  return { modalidade, exame, contraste: detectarContraste(texto), lateral };
}

/**
 * Agrupa classificações equivalentes em clusters (mesma modalidade/exame/contraste),
 * usados para sugerir uma máscara-consenso. Laterais colapsam num cluster só —
 * a chave não inclui lateralidade, e o cluster carrega `lateral: true` se QUALQUER
 * documento do grupo for lateral.
 */
export function agruparClusters(docs: { arquivo: string; c: Classificacao }[]): Cluster[] {
  const porChave = new Map<string, Cluster>();
  for (const { arquivo, c } of docs) {
    const chave = `${c.modalidade}-${c.exame ?? 'nao-reconhecido'}${c.contraste === 'com' ? '-com-contraste' : ''}`;
    const existente = porChave.get(chave);
    if (existente) {
      existente.arquivos.push(arquivo);
      if (c.lateral) existente.lateral = true;
    } else {
      porChave.set(chave, {
        chave,
        modalidade: c.modalidade,
        exame: c.exame,
        contraste: c.contraste,
        lateral: c.lateral,
        arquivos: [arquivo],
      });
    }
  }
  return [...porChave.values()];
}

/** Sugere o id de máscara para um cluster — a própria chave (padrão `tc-abdome-total-com-contraste`). */
export function sugerirMaskId(cluster: Cluster): string {
  return cluster.chave;
}
