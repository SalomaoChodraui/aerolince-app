/**
 * Histórico de laudos: lê a pasta de saída e os sidecars .json.
 * Suporta o loop de feedback — o texto final editado pelo médico é gravado de
 * volta no .txt e no sidecar (campo `laudoFinalEditado` + `editadoEm`).
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface ItemHistorico {
  arquivo: string;
  data: string;
  maskId: string;
  transcript: string;
  preview: string;
  /** Texto completo em minúsculas — para a busca casar qualquer achado do laudo. */
  busca: string;
  editado: boolean;
}

export function listarHistorico(outputDir: string, limite = 200): ItemHistorico[] {
  if (!existsSync(outputDir)) return [];
  const txts = readdirSync(outputDir)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .reverse()
    .slice(0, limite);
  return txts.map((f) => {
    const txtPath = join(outputDir, f);
    const texto = readFileSync(txtPath, 'utf8');
    const sidecarPath = txtPath.replace(/\.txt$/, '.json');
    let meta: Record<string, unknown> = {};
    if (existsSync(sidecarPath)) {
      try {
        meta = JSON.parse(readFileSync(sidecarPath, 'utf8'));
      } catch {
        /* sidecar inválido — segue com o txt */
      }
    }
    const nome = basename(f, '.txt');
    const transcript = (meta.transcript as string) ?? '';
    const maskId = (meta.maskId as string) ?? nome.split('_').slice(2).join('_');
    return {
      arquivo: f,
      data: nome.slice(0, 16).replace('_', ' '),
      maskId,
      transcript,
      preview: texto.split('\n').filter(Boolean).slice(0, 3).join(' '),
      busca: `${maskId} ${transcript} ${texto}`.toLowerCase(),
      editado: Boolean(meta.editadoEm),
    };
  });
}

export function lerLaudo(outputDir: string, arquivo: string): string {
  const p = join(outputDir, basename(arquivo));
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/**
 * Loop de feedback: grava a versão final editada pelo médico. Como o ditado e o
 * laudo não contêm identificação de paciente, este material fica localmente e
 * alimenta o aprendizado do estilo (diff gerado→final).
 */
export function salvarFinalEditado(outputDir: string, arquivo: string, textoFinal: string, geradoEm?: string): void {
  const txtPath = join(outputDir, basename(arquivo));
  if (!existsSync(txtPath)) return;
  const original = readFileSync(txtPath, 'utf8');
  if (original === textoFinal) return; // nada mudou
  writeFileSync(txtPath, textoFinal, 'utf8');
  const sidecarPath = txtPath.replace(/\.txt$/, '.json');
  let meta: Record<string, unknown> = {};
  if (existsSync(sidecarPath)) {
    try {
      meta = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    } catch {
      /* recria */
    }
  }
  meta.laudoGerado = meta.laudoGerado ?? original;
  meta.laudoFinalEditado = textoFinal;
  meta.editadoEm = geradoEm ?? 'sim';
  writeFileSync(sidecarPath, JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * Apaga um laudo do histórico (par .txt + sidecar .json). O caminho é resolvido
 * SEMPRE dentro de outputDir via `basename` — o identificador vindo do renderer
 * nunca é usado como caminho direto (barra path traversal). Retorna false se o
 * .txt não existir. Deleção irreversível — a confirmação fica no chamador (main).
 */
export function apagarLaudo(outputDir: string, identificador: string): boolean {
  const alvo = join(outputDir, basename(identificador));
  if (!existsSync(alvo)) return false;
  apagarPar(alvo);
  return true;
}

/** Apaga TODOS os laudos do histórico (pares .txt + .json). Retorna a contagem. */
export function apagarTodosLaudos(outputDir: string): number {
  if (!existsSync(outputDir)) return 0;
  const txts = readdirSync(outputDir).filter((f) => f.endsWith('.txt'));
  for (const f of txts) apagarPar(join(outputDir, f));
  return txts.length;
}

/** Quantos laudos (.txt) há no histórico — usado no texto da confirmação. */
export function contarLaudos(outputDir: string): number {
  if (!existsSync(outputDir)) return 0;
  return readdirSync(outputDir).filter((f) => f.endsWith('.txt')).length;
}

/**
 * Decisão pura da retenção: dos arquivos dados, quais estão além do prazo.
 * `retencaoDias` 0 = manter sempre (nunca vence). Vencido é estritamente mais
 * antigo que o corte — um arquivo exatamente no corte é preservado.
 */
export function vencidos(
  arquivos: { path: string; mtimeMs: number }[],
  retencaoDias: number,
  agora: number,
): string[] {
  if (retencaoDias <= 0) return [];
  const corte = agora - retencaoDias * 24 * 60 * 60 * 1000;
  return arquivos.filter((a) => a.mtimeMs < corte).map((a) => a.path);
}

/**
 * Limpeza da retenção (melhor-esforço, chamada no boot): apaga os pares vencidos
 * e retorna quantos laudos foram apagados. `retencaoDias` 0 nunca apaga.
 */
export function limparVencidos(outputDir: string, retencaoDias: number, agora: number): number {
  if (retencaoDias <= 0 || !existsSync(outputDir)) return 0;
  const arquivos = readdirSync(outputDir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => {
      const path = join(outputDir, f);
      return { path, mtimeMs: statSync(path).mtimeMs };
    });
  const alvos = vencidos(arquivos, retencaoDias, agora);
  for (const p of alvos) apagarPar(p);
  return alvos.length;
}

/** Apaga o .txt e o sidecar .json par (caminho já resolvido/validado). */
function apagarPar(txtPath: string): void {
  rmSync(txtPath, { force: true });
  const sidecar = txtPath.replace(/\.txt$/, '.json');
  if (existsSync(sidecar)) rmSync(sidecar, { force: true });
}
