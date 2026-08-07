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

/** Tabela de sinônimos mínima: fragmento do complemento → slug canônico do exame. */
function sinonimoExame(fraseSemLateralidade: string): string | null {
  const f = fraseSemLateralidade;
  if (/\b(?:encefalo|cranio)\b/.test(f)) return 'cranio';
  if (/\babdome\b/.test(f)) return 'abdome-total';
  if (/\btorax\b/.test(f)) return 'torax';
  if (/\bcoluna\s+lombar\b|\blombo-?sacra\b/.test(f)) return 'coluna-lombar';
  if (/\bcoluna\s+cervical\b/.test(f)) return 'coluna-cervical';
  if (/\bcoluna\s+toracica\b/.test(f)) return 'coluna-toracica';
  if (/seios da face|\bface\b/.test(f)) return 'seios-da-face';
  if (/\bsacro-?iliacas?\b/.test(f)) return 'sacro-iliacas';
  const membro = /\b(joelho|ombro|punho|cotovelo|tornozelo|pe|mao|bacia|quadril)\b/.exec(f);
  if (membro) return membro[1] ?? null;
  return null;
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
 * Gatilhos positivos de contraste — frases da convenção do serviço (PT-BR formal de laudo).
 * "injeção intravenosa/endovenosa" e "uso intravenoso/endovenoso" são os DOIS fraseados
 * REAIS de Técnica encontrados nas 18 máscaras da biblioteca-base: 17 delas usam "injeção
 * intravenosa" (ex.: tc-abdome-total-com-contraste.md: "após injeção intravenosa do meio
 * de contraste iodado") e tc-cranio.md, sozinha, usa "uso intravenoso" ("sem uso
 * intravenoso do meio de contraste iodado"). "Endovenoso" é sinônimo comum de
 * "intravenoso" em laudos reais — incluído por robustez, mesmo sem ocorrência literal na
 * base atual. Sem essas variantes, laudos reais COM contraste cairiam no default 'sem'.
 */
const CONTRASTE_POSITIVO =
  /\bcom contraste\b|\badministracao intravenosa\b|\buso do meio de contraste\b|\binjecao (?:intravenosa|endovenosa)\b|\buso (?:intravenoso|endovenoso)\b/;

/**
 * Negação PRÓXIMA aos gatilhos — cuidado: "administração/injeção/uso intravenoso" sozinha
 * é a frase AFIRMATIVA; a negativa típica é "SEM a administração/injeção
 * intravenosa"/"sem uso intravenoso"/"sem contraste"/"não foi administrado". Sem checar
 * negação, um laudo SEM contraste que cita a frase dentro da negativa seria classificado
 * como COM contraste (ex.: tc-abdome-total.md: "sem injeção intravenosa do meio de
 * contraste"; tc-cranio.md: "sem uso intravenoso do meio de contraste").
 */
const CONTRASTE_NEGACAO =
  /\bsem\s+(?:a\s+)?administracao\b|\bsem\s+(?:a\s+)?injecao\b|\bsem\s+(?:o\s+)?uso\b|\bsem contraste\b|\bnao foi administrado\b/;

/**
 * Detecta uso de contraste no texto inteiro do documento (título + corpo).
 * Espelha a convenção de `citaContraste` (masks/matcher.ts), mas — diferente
 * dela — reconhece negação, pois o acervo tem laudos SEM contraste que citam a
 * frase "administração/injeção/uso intravenoso" dentro de uma negativa.
 */
function detectarContraste(texto: string): 'com' | 'sem' {
  const t = normalizar(texto);
  if (CONTRASTE_NEGACAO.test(t)) return 'sem';
  if (CONTRASTE_POSITIVO.test(t)) return 'com';
  return 'sem';
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
