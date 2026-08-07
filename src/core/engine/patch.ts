/**
 * Modo patch: o LLM emite APENAS os blocos que mudam e o motor monta o laudo
 * localmente sobre a máscara. Custo de saída ~5× menor e garantia estrutural:
 * todo texto não referenciado por um patch fica byte-idêntico à máscara.
 *
 * Formato emitido pelo modelo (blocos separados por linhas "@@"):
 *   @@ substituir: rins
 *   <novo texto do bloco>
 *   @@ inserir-apos: aorta | id: colon
 *   <texto do bloco novo>
 *   @@ substituir: impressao
 *   <nova conclusão>
 *   @@ titulo
 *   TOMOGRAFIA COMPUTADORIZADA DO JOELHO DIREITO
 *   @@ tecnica
 *   <nova linha de técnica>
 *   @@ achado-adicional      (sem alvo: achado fora da região do exame; o motor o
 *   <frase do achado>         insere na seção "Achados adicionais" da Análise,
 *                             imediatamente antes de "Conclusão:"/"Opinião:" —
 *                             o rótulo é criado uma única vez)
 *   @@ remover: <id>         (apaga o bloco inteiro — marcador, texto e a linha
 *                             em branco separadora; sem texto após o cabeçalho)
 *   @@ sem-alteracoes        (sozinho: exame normal, máscara sai intacta)
 */

export interface PatchOp {
  tipo:
    | 'substituir'
    | 'inserir-apos'
    | 'inserir-antes'
    | 'achado-adicional'
    | 'remover'
    | 'titulo'
    | 'tecnica'
    | 'sem-alteracoes';
  alvo?: string;
  novoId?: string;
  texto: string;
}

export class PatchError extends Error {}

const HEADER_RE = /^@@\s*(.+?)\s*$/;

/** Id e rótulo fixos da seção de achados fora da região do exame. */
const ACHADOS_ADICIONAIS_ID = 'achados-adicionais';
const ACHADOS_ADICIONAIS_ROTULO = 'Achados adicionais:';

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Normaliza um id de bloco para o formato canônico ASCII kebab-case (o único que stripMarkers/máscaras usam). */
function normalizarId(id: string): string {
  return semAcento(id)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parsePatches(raw: string): PatchOp[] {
  const text = raw.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
  const lines = text.split('\n');
  const ops: PatchOp[] = [];
  let current: PatchOp | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      current.texto = buffer.join('\n').trim();
      ops.push(current);
    }
    buffer = [];
  };

  for (const line of lines) {
    const m = line.match(HEADER_RE);
    if (!m) {
      if (current) buffer.push(line);
      continue;
    }
    flush();
    const header = m[1]!.toLowerCase();
    if (header === 'sem-alteracoes') current = { tipo: 'sem-alteracoes', texto: '' };
    else if (semAcento(header) === 'titulo') current = { tipo: 'titulo', texto: '' };
    else if (semAcento(header) === 'tecnica') current = { tipo: 'tecnica', texto: '' };
    else if (semAcento(header) === 'achado-adicional' || semAcento(header) === 'achados-adicionais') {
      // Tolerância ao plural: o modelo às vezes usa o nome da seção como cabeçalho
      current = { tipo: 'achado-adicional', texto: '' };
    } else if (header.startsWith('remover:')) {
      current = { tipo: 'remover', alvo: normalizarId(header.slice('remover:'.length).trim()), texto: '' };
    } else if (header.startsWith('substituir:')) {
      const alvo = header.slice('substituir:'.length).trim();
      const alvoN = semAcento(alvo);
      // Tolerância: o modelo às vezes usa "substituir: tecnica/titulo" em vez do cabeçalho próprio
      if (alvoN === 'tecnica') current = { tipo: 'tecnica', texto: '' };
      else if (alvoN === 'titulo') current = { tipo: 'titulo', texto: '' };
      else current = { tipo: 'substituir', alvo: normalizarId(alvo), texto: '' };
    } else if (header.startsWith('inserir-apos:') || header.startsWith('inserir-antes:')) {
      const tipo = header.startsWith('inserir-antes:') ? 'inserir-antes' : 'inserir-apos';
      const resto = header.slice(header.indexOf(':') + 1);
      const [alvo, idParte] = resto.split('|');
      current = {
        tipo,
        alvo: normalizarId(alvo!.trim()),
        novoId: normalizarId(idParte?.replace(/^\s*id:\s*/, '').trim() ?? '') || 'novo',
        texto: '',
      };
    } else {
      throw new PatchError(`cabeçalho de patch desconhecido: "@@ ${m[1]}"`);
    }
  }
  flush();
  for (const op of ops) {
    // "remover" e "sem-alteracoes" são cabeçalhos sem corpo; os demais exigem texto
    if (op.tipo !== 'sem-alteracoes' && op.tipo !== 'remover' && !op.texto) {
      throw new PatchError(`patch "${op.tipo}${op.alvo ? `: ${op.alvo}` : ''}" com texto vazio`);
    }
    if (op.tipo === 'remover' && !op.alvo) {
      throw new PatchError('patch "remover" sem id de bloco');
    }
  }
  if (ops.length === 0) throw new PatchError('resposta sem nenhum patch reconhecível');
  return ops;
}

const markerRe = (id: string) =>
  new RegExp(`(<!--\\s*(?:orgao:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${id === 'impressao' ? 'impressao' : '__nunca__'})\\s*-->)\\n`, 'i');

/** Localiza um bloco marcado: retorna [inícioDoMarcador, fimDoBloco (antes da linha em branco)]. */
function blockRange(body: string, id: string): [number, number] | null {
  const m = body.match(markerRe(id));
  if (!m || m.index === undefined) return null;
  const textStart = m.index + m[0].length;
  const blank = body.indexOf('\n\n', textStart);
  return [m.index, blank === -1 ? body.length : blank];
}

/**
 * Offset do início da linha que abre a conclusão ("Conclusão:" ou "Opinião:" —
 * o crânio usa Opinião; case/acento-insensível, com ou sem "##"), ou -1.
 */
function inicioConclusao(body: string): number {
  let offset = 0;
  for (const line of body.split('\n')) {
    const norm = semAcento(line.trim()).toLowerCase();
    if (/^#{0,6}\s*(conclusao|opiniao):?$/.test(norm)) return offset;
    offset += line.length + 1;
  }
  return -1;
}

export function applyPatches(maskBody: string, ops: PatchOp[]): string {
  let body = maskBody;
  for (const op of ops) {
    if (op.tipo === 'sem-alteracoes') continue;
    if (op.tipo === 'titulo') {
      if (!op.texto) throw new PatchError('patch de título vazio');
      const nl = body.indexOf('\n');
      body = op.texto + body.slice(nl);
      continue;
    }
    if (op.tipo === 'tecnica') {
      const m = body.match(/(T[eé]cnica:\s*\n\n)/i);
      if (!m || m.index === undefined) throw new PatchError('seção Técnica não encontrada');
      const start = m.index + m[0].length;
      const end = body.indexOf('\n\n', start);
      body = body.slice(0, start) + op.texto + body.slice(end === -1 ? body.length : end);
      continue;
    }
    if (op.tipo === 'achado-adicional') {
      const existente = blockRange(body, ACHADOS_ADICIONAIS_ID);
      if (existente) {
        // Seção já criada (2º achado no mesmo laudo ou refino): acrescenta a frase, sem duplicar o rótulo
        const [, fim] = existente;
        body = `${body.slice(0, fim)}\n${op.texto}${body.slice(fim)}`;
        continue;
      }
      const secao = `<!-- orgao: ${ACHADOS_ADICIONAIS_ID} -->\n${ACHADOS_ADICIONAIS_ROTULO}\n${op.texto}`;
      const pos = inicioConclusao(body);
      body =
        pos === -1
          ? `${body.replace(/\s+$/, '')}\n\n${secao}` // máscara sem linha de conclusão (degenerado)
          : `${body.slice(0, pos)}${secao}\n\n${body.slice(pos)}`;
      continue;
    }
    if (!op.alvo) throw new PatchError(`patch ${op.tipo} sem alvo`);
    const range = blockRange(body, op.alvo);
    if (!range) throw new PatchError(`bloco não encontrado na máscara: "${op.alvo}"`);
    const [start, end] = range;
    if (op.tipo === 'remover') {
      body =
        end < body.length
          ? body.slice(0, start) + body.slice(end + 2) // consome também a linha em branco separadora
          : body.slice(0, start).replace(/\n+$/, ''); // último bloco: remove a separação que o precedia
    } else if (op.tipo === 'substituir') {
      const markerLen = body.slice(start).indexOf('\n') + 1;
      body = body.slice(0, start + markerLen) + op.texto + body.slice(end);
    } else if (op.tipo === 'inserir-antes') {
      const inserido = `<!-- orgao: ${op.novoId} -->\n${op.texto}\n\n`;
      body = body.slice(0, start) + inserido + body.slice(start);
    } else {
      // inserir-apos
      const inserido = `\n\n<!-- orgao: ${op.novoId} -->\n${op.texto}`;
      body = body.slice(0, end) + inserido + body.slice(end);
    }
  }
  return body;
}

/** Ids alterados/inseridos/removidos — vira o diff exato mostrado ao médico. */
export function patchedIds(ops: PatchOp[]): string[] {
  const ids = ops
    .filter((o) => o.tipo !== 'sem-alteracoes' && o.tipo !== 'titulo' && o.tipo !== 'tecnica')
    .map((o) => {
      if (o.tipo === 'achado-adicional') return ACHADOS_ADICIONAIS_ID;
      if (o.tipo === 'substituir' || o.tipo === 'remover') return o.alvo!;
      return o.novoId ?? 'novo';
    })
    .concat(ops.some((o) => o.tipo === 'titulo' || o.tipo === 'tecnica') ? ['tecnica'] : []);
  return [...new Set(ids)];
}
