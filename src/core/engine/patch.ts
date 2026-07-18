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
 *   @@ sem-alteracoes        (sozinho: exame normal, máscara sai intacta)
 */

export interface PatchOp {
  tipo: 'substituir' | 'inserir-apos' | 'titulo' | 'tecnica' | 'sem-alteracoes';
  alvo?: string;
  novoId?: string;
  texto: string;
}

export class PatchError extends Error {}

const HEADER_RE = /^@@\s*(.+?)\s*$/;

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
    else if (header === 'titulo') current = { tipo: 'titulo', texto: '' };
    else if (header === 'tecnica') current = { tipo: 'tecnica', texto: '' };
    else if (header.startsWith('substituir:')) {
      current = { tipo: 'substituir', alvo: header.slice('substituir:'.length).trim(), texto: '' };
    } else if (header.startsWith('inserir-apos:')) {
      const resto = header.slice('inserir-apos:'.length);
      const [alvo, idParte] = resto.split('|');
      current = {
        tipo: 'inserir-apos',
        alvo: alvo!.trim(),
        novoId: idParte?.replace(/^\s*id:\s*/, '').trim() || 'novo',
        texto: '',
      };
    } else {
      throw new PatchError(`cabeçalho de patch desconhecido: "@@ ${m[1]}"`);
    }
  }
  flush();
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
    if (!op.alvo) throw new PatchError(`patch ${op.tipo} sem alvo`);
    const range = blockRange(body, op.alvo);
    if (!range) throw new PatchError(`bloco não encontrado na máscara: "${op.alvo}"`);
    const [start, end] = range;
    if (op.tipo === 'substituir') {
      const markerLen = body.slice(start).indexOf('\n') + 1;
      body = body.slice(0, start + markerLen) + op.texto + body.slice(end);
    } else {
      // inserir-apos
      const inserido = `\n\n<!-- orgao: ${op.novoId} -->\n${op.texto}`;
      body = body.slice(0, end) + inserido + body.slice(end);
    }
  }
  return body;
}

/** Ids alterados/inseridos — vira o diff exato mostrado ao médico. */
export function patchedIds(ops: PatchOp[]): string[] {
  return ops
    .filter((o) => o.tipo === 'substituir' || o.tipo === 'inserir-apos')
    .map((o) => (o.tipo === 'inserir-apos' ? (o.novoId ?? 'novo') : o.alvo!))
    .concat(ops.some((o) => o.tipo === 'titulo' || o.tipo === 'tecnica') ? ['tecnica'] : []);
}
