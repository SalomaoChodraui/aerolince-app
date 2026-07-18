/**
 * Histórico de laudos: lê a pasta de saída e os sidecars .json.
 * Suporta o loop de feedback — o texto final editado pelo médico é gravado de
 * volta no .txt e no sidecar (campo `laudoFinalEditado` + `editadoEm`).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface ItemHistorico {
  arquivo: string;
  data: string;
  maskId: string;
  transcript: string;
  preview: string;
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
    return {
      arquivo: f,
      data: nome.slice(0, 16).replace('_', ' '),
      maskId: (meta.maskId as string) ?? nome.split('_').slice(2).join('_'),
      transcript: (meta.transcript as string) ?? '',
      preview: texto.split('\n').filter(Boolean).slice(0, 3).join(' '),
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
